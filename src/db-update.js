import csv from 'csv-parser';
import dayjs from 'dayjs';
import fs from 'fs';
import fetch from 'node-fetch';
import pMap from 'p-map';
import winston from 'winston';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
    ],
    exitOnError: false,
});

import * as alphavantage from './alphavantage.js';
import * as db from './db.js';

/** @type {string[]} */
const ALL_SYMBOLS = JSON.parse(fs.readFileSync('src/symbols.json').toString());
const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * @typedef {object} SymbolSince
 * @property {string} symbol Stock ticker symbol.
 * @property {string} since Inclusive lower date bound in YYYY-MM-DD format.
 */

/**
 * @typedef {object} OverviewRecord
 * @property {string | undefined} [symbol] Stock ticker symbol.
 * @property {string | undefined} [date] Snapshot date in YYYY-MM-DD format.
 */

/**
 * @typedef {object} VixCsvRow
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} open Opening value.
 * @property {number} high Daily high.
 * @property {number} low Daily low.
 * @property {number} close Closing value.
 * @property {number | undefined} [sma10] 10-day simple moving average.
 * @property {number | undefined} [sma15] 15-day simple moving average.
 * @property {number | undefined} [sma20] 20-day simple moving average.
 * @property {number | undefined} [sma50] 50-day simple moving average.
 * @property {number | undefined} [sma100] 100-day simple moving average.
 * @property {number | undefined} [sma200] 200-day simple moving average.
 */

/** @typedef {Pick<db.TechnicalIndicator, 'symbol' | 'date'> & Partial<Omit<db.TechnicalIndicator, 'symbol' | 'date'>>} TechnicalIndicatorUpsert */

const RSI14_SMA_PERIOD = 14;

/**
 * Calculates a simple moving average over the last `period` numeric values.
 *
 * @param {number[]} values Values ordered from oldest to newest.
 * @param {number} period Window size.
 * @returns {number} Simple moving average.
 */
function calcSMA(values, period) {
    return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Loads the previous RSI14 values from MongoDB and computes SMA14 values for the newly fetched RSI14 series.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {alphavantage.RSIRecord[]} rsi14s Newly fetched RSI14 values.
 * @returns {Promise<Map<string, number>>} RSI14 SMA14 values keyed by trading date.
 */
async function getRsi14Sma14ByDate(symbol, rsi14s) {
    if (rsi14s.length === 0) {
        return new Map();
    }

    const earliestRsi14Date = rsi14s.reduce((earliestDate, rsi14) => {
        return rsi14.date < earliestDate ? rsi14.date : earliestDate;
    }, rsi14s[0].date);

    /** @type {Array<Pick<db.TechnicalIndicator, 'date' | 'rsi14'>>} */
    // @ts-ignore Mongoose query typing is wider than the projection shape used here.
    const historicalRsi14s = await db.TechnicalIndicator.find({
        symbol: symbol,
        date: { $lt: earliestRsi14Date },
        rsi14: { $exists: true },
    })
        .select({ date: 1, rsi14: 1, _id: 0 })
        .sort({ date: 'desc' })
        .limit(RSI14_SMA_PERIOD - 1)
        .exec();

    const rsiWindow = historicalRsi14s
        .slice()
        .reverse()
        .map((technicalIndicator) => technicalIndicator.rsi14)
        .filter((rsi14) => rsi14 !== undefined);

    /** @type {Map<string, number>} */
    const rsi14Sma14ByDate = new Map();
    const rsi14sAscending = rsi14s.slice().sort((left, right) => left.date.localeCompare(right.date));
    rsi14sAscending.forEach((rsi14) => {
        rsiWindow.push(rsi14.rsi);
        if (rsiWindow.length > RSI14_SMA_PERIOD) {
            rsiWindow.shift();
        }
        if (rsiWindow.length === RSI14_SMA_PERIOD) {
            rsi14Sma14ByDate.set(rsi14.date, calcSMA(rsiWindow, RSI14_SMA_PERIOD));
        }
    });

    return rsi14Sma14ByDate;
}

// see https://www.investopedia.com/terms/s/sma.asp
/**
 * Fetches VIX history, derives rolling averages, and upserts rows from the requested date onward.
 *
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<void>}
 */
async function updateVix(since) {
    // see https://www.cboe.com/tradable_products/vix/vix_historical_data/
    const vixHistory = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    if (!vixHistory.body) {
        throw new Error('missing VIX CSV response body');
    }
    const vixHistoryBody = vixHistory.body;

    /** @type {VixCsvRow[]} */
    const results = [];
    await new Promise((resolve, reject) => {
        vixHistoryBody
            .pipe(
                csv({
                    // eslint-disable-next-line no-unused-vars
                    mapHeaders: ({ header, index }) => header.toLowerCase(),
                    // eslint-disable-next-line no-unused-vars
                    mapValues: ({ header, index, value }) => {
                        if (header === 'date') {
                            return dayjs(value).format(DATE_FORMAT);
                        }
                        return Number(value);
                    },
                }),
            )
            .on('data', (data) => results.push(/** @type {VixCsvRow} */ (data)))
            .on('end', () => {
                /** @type {number[]} */
                const closes = [];
                /** @type {PromiseLike<unknown>[]} */
                const allPromises = [];

                results.forEach((vix) => {
                    closes.push(vix.close);
                    if (closes.length >= 10) {
                        vix.sma10 = calcSMA(closes, 10);
                    }
                    if (closes.length >= 15) {
                        vix.sma15 = calcSMA(closes, 15);
                    }
                    if (closes.length >= 20) {
                        vix.sma20 = calcSMA(closes, 20);
                    }
                    if (closes.length >= 50) {
                        vix.sma50 = calcSMA(closes, 50);
                    }
                    if (closes.length >= 100) {
                        vix.sma100 = calcSMA(closes, 100);
                    }
                    if (closes.length >= 200) {
                        vix.sma200 = calcSMA(closes, 200);
                    }
                    if (closes.length > 200) {
                        closes.shift();
                    }
                    if (vix.date >= since) {
                        allPromises.push(db.VIX.updateOne({ date: vix.date }, vix, { upsert: true }));
                    }
                });

                Promise.all(allPromises).then(
                    () => {
                        logger.info('finished VIX');
                        resolve(undefined);
                    },
                    (err) => reject(err),
                );
            })
            .on('error', reject);
    });
}

/**
 * Updates one symbol/date job entry from the p-map queue.
 *
 * @param {SymbolSince} symbolSince Symbol and lower date bound.
 * @returns {Promise<void>}
 */
async function updateSymbol(symbolSince) {
    return updateSymbolAsync(symbolSince.symbol, symbolSince.since);
}

/**
 * Update the database for a symbol since a date. The date is used to limit the data from Alpha Vantage, but the
 * function will update all data in the database for that symbol and date, so it can be used to fix any bad data in the
 * database.

 * @param {string} symbol stock symbol, e.g. AAPL
 * @param {string} since date in YYYY-MM-DD format, e.g. 2020-01-01
 * @returns {Promise<void>}
 */
async function updateSymbolAsync(symbol, since) {
    logger.info(symbol + ' ...');

    /** @type {PromiseLike<unknown>[]} */
    let allPromises = [];
    try {
        const overview = /** @type {OverviewRecord & Object.<string, unknown>} */ (
            await alphavantage.queryCompanyOverview(symbol)
        );
        if (typeof overview.symbol === 'string') {
            // e.g. BYDDF and XIACF do not
            overview.date = dayjs().format(DATE_FORMAT);
            allPromises.push(
                db.CompanyOverview.updateOne({ symbol: symbol, date: overview.date }, overview, { upsert: true }),
            );
        }

        const dailyAdjusteds = await alphavantage.queryDailyAdjusted(symbol, since);
        dailyAdjusteds
            .filter((da) => da.splitCoefficient !== 1)
            .forEach((da) => {
                logger.info(da.symbol + ' split on ' + da.date + ' ' + da.splitCoefficient + ':1');
            });
        if (dailyAdjusteds.length === 0) {
            logger.info('no updates for ' + symbol);
            return;
        }
        dailyAdjusteds.forEach((da) => {
            allPromises.push(db.DailyAdjusted.updateOne({ symbol: symbol, date: da.date }, da, { upsert: true }));
        });

        const sma15s = await alphavantage.querySMA(symbol, 15, since);
        const sma20s = await alphavantage.querySMA(symbol, 20, since);
        const sma50s = await alphavantage.querySMA(symbol, 50, since);
        const sma100s = await alphavantage.querySMA(symbol, 100, since);
        const sma200s = await alphavantage.querySMA(symbol, 200, since);
        const sma250s = await alphavantage.querySMA(symbol, 250, since);
        const ema5s = await alphavantage.queryEMA(symbol, 5, since);
        const ema8s = await alphavantage.queryEMA(symbol, 8, since);
        const ema9s = await alphavantage.queryEMA(symbol, 9, since);
        const ema12s = await alphavantage.queryEMA(symbol, 12, since);
        const ema13s = await alphavantage.queryEMA(symbol, 13, since);
        const ema20s = await alphavantage.queryEMA(symbol, 20, since);
        const ema21s = await alphavantage.queryEMA(symbol, 21, since);
        const ema26s = await alphavantage.queryEMA(symbol, 26, since);
        const ema34s = await alphavantage.queryEMA(symbol, 34, since);
        const ema50s = await alphavantage.queryEMA(symbol, 50, since);
        const ema100s = await alphavantage.queryEMA(symbol, 100, since);
        const ema200s = await alphavantage.queryEMA(symbol, 200, since);
        const ema250s = await alphavantage.queryEMA(symbol, 250, since);
        const macds = await alphavantage.queryMACD(symbol, since);
        const rsi2s = await alphavantage.queryRSI(symbol, 2, since);
        const rsi14s = await alphavantage.queryRSI(symbol, 14, since);
        const rsi14Sma14ByDate = await getRsi14Sma14ByDate(symbol, rsi14s);
        const bbands = await alphavantage.queryBBands(symbol, 20, since);
        const atr14s = await alphavantage.queryATR(symbol, 14, since);
        const natr14s = await alphavantage.queryNATR(symbol, 14, since);

        for (let i = 0; i < dailyAdjusteds.length; i++) {
            const filter = { symbol: symbol, date: dailyAdjusteds[i].date };
            /** @type {TechnicalIndicatorUpsert} */
            const ti = { ...filter };

            if (i < sma250s.length) {
                if (
                    sma15s[i].date !== dailyAdjusteds[i].date ||
                    sma20s[i].date !== dailyAdjusteds[i].date ||
                    sma50s[i].date !== dailyAdjusteds[i].date ||
                    sma100s[i].date !== dailyAdjusteds[i].date ||
                    sma200s[i].date !== dailyAdjusteds[i].date ||
                    sma250s[i].date !== dailyAdjusteds[i].date ||
                    ema5s[i].date !== dailyAdjusteds[i].date ||
                    ema8s[i].date !== dailyAdjusteds[i].date ||
                    ema9s[i].date !== dailyAdjusteds[i].date ||
                    ema12s[i].date !== dailyAdjusteds[i].date ||
                    ema13s[i].date !== dailyAdjusteds[i].date ||
                    ema20s[i].date !== dailyAdjusteds[i].date ||
                    ema21s[i].date !== dailyAdjusteds[i].date ||
                    ema26s[i].date !== dailyAdjusteds[i].date ||
                    ema34s[i].date !== dailyAdjusteds[i].date ||
                    ema50s[i].date !== dailyAdjusteds[i].date ||
                    ema100s[i].date !== dailyAdjusteds[i].date ||
                    ema200s[i].date !== dailyAdjusteds[i].date ||
                    ema250s[i].date !== dailyAdjusteds[i].date ||
                    macds[i].date !== dailyAdjusteds[i].date ||
                    rsi2s[i].date !== dailyAdjusteds[i].date ||
                    rsi14s[i].date !== dailyAdjusteds[i].date ||
                    bbands[i].date !== dailyAdjusteds[i].date ||
                    atr14s[i].date !== dailyAdjusteds[i].date ||
                    natr14s[i].date !== dailyAdjusteds[i].date
                ) {
                    throw new Error('diff. date ' + symbol);
                }
            }

            // TODO @ripster47 ema clouds for 10 min candles
            /*
            study(title="ema clouds strategy ripster", shorttitle="ema webull clouds", overlay=true)

ema8 = ema(close, 8)
ema21 = ema(close, 21)
ema34 = ema(close, 34)
ema50 = ema(close, 50)
//Top charts
ema8plot = plot(ema8, color=#2ecc71, transp=100, style=plot.style_line, linewidth=1, title="EMA(8)")
ema21plot = plot(ema21, color=#2ecc71, transp=100, style=plot.style_line, linewidth=1, title="EMA(21)")
fill(ema8plot, ema21plot, color=ema8 > ema21 ? color.green : color.red, transp=60, editable=true)
//bottom charts
ema34plot = plot(ema34, color=#2ecc71, transp=100, style=plot.style_line, linewidth=1, title="EMA(34)")
ema50plot = plot(ema50, color=#2ecc71, transp=100, style=plot.style_line, linewidth=1, title="EMA(50)")
fill(ema34plot, ema50plot, color=ema34 > ema50 ? color.green : color.red, transp=60, editable=true)
            */

            if (sma15s[i]) ti.sma15 = sma15s[i].sma;
            if (sma20s[i]) ti.sma20 = sma20s[i].sma;
            if (sma50s[i]) ti.sma50 = sma50s[i].sma;
            if (sma100s[i]) ti.sma100 = sma100s[i].sma;
            if (sma200s[i]) ti.sma200 = sma200s[i].sma;
            if (sma250s[i]) ti.sma250 = sma250s[i].sma;
            if (ema5s[i]) ti.ema5 = ema5s[i].ema;
            if (ema8s[i]) ti.ema8 = ema8s[i].ema;
            if (ema9s[i]) ti.ema9 = ema9s[i].ema;
            if (ema12s[i]) ti.ema12 = ema12s[i].ema;
            if (ema13s[i]) ti.ema13 = ema13s[i].ema;
            if (ema20s[i]) ti.ema20 = ema20s[i].ema;
            if (ema21s[i]) ti.ema21 = ema21s[i].ema;
            if (ema26s[i]) ti.ema26 = ema26s[i].ema;
            if (ema34s[i]) ti.ema34 = ema34s[i].ema;
            if (ema50s[i]) ti.ema50 = ema50s[i].ema;
            if (ema100s[i]) ti.ema100 = ema100s[i].ema;
            if (ema200s[i]) ti.ema200 = ema200s[i].ema;
            if (ema250s[i]) ti.ema250 = ema250s[i].ema;
            if (macds[i]) {
                ti.macd = macds[i].macd;
                ti.macdHist = macds[i].hist;
                ti.macdSignal = macds[i].signal;
            }
            if (rsi2s[i]) ti.rsi2 = rsi2s[i].rsi;
            if (rsi14s[i]) {
                ti.rsi14 = rsi14s[i].rsi;
                const rsi14Sma14 = rsi14Sma14ByDate.get(rsi14s[i].date);
                if (rsi14Sma14 !== undefined) {
                    ti.rsi14Sma14 = rsi14Sma14;
                }
            }
            if (bbands[i]) {
                ti.bbandLower = bbands[i].lower;
                ti.bbandUpper = bbands[i].upper;
                ti.bbandMiddle = bbands[i].middle;
            }
            if (atr14s[i]) ti.atr14 = atr14s[i].atr;
            if (natr14s[i]) ti.natr14 = natr14s[i].natr;

            allPromises.push(db.TechnicalIndicator.updateOne(filter, ti, { upsert: true }));
        }

        console.log('all promises ' + symbol, allPromises.length);
        await Promise.all(allPromises);
    } catch (err) {
        logger.error(symbol, err);
    }
}

const args = process.argv.slice(2);
const symbols = args[0] === '*' ? ALL_SYMBOLS : args[0].split(',');
const since = args[1] || '2018-01-01';

logger.info('getting data for VIX since ' + since + ' ...');
updateVix(since);

logger.info('getting data for ' + symbols + ' since ' + since + ' ...');

pMap(
    symbols.map((symbol) => ({ symbol, since })),
    updateSymbol,
    { concurrency: 1, stopOnError: false },
).then(() => {
    logger.info('done, waiting to finish ...');
    db.disconnect();
});
