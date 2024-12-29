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

const ALL_SYMBOLS = JSON.parse(fs.readFileSync('src/symbols.json'));
const DATE_FORMAT = 'YYYY-MM-DD';

// see https://www.investopedia.com/terms/s/sma.asp
async function updateVix(since) {
    const calcSMA = (prices, n) => {
        return prices.slice(-n).reduce((sum, price) => sum + price, 0) / n;
    };

    // see https://www.cboe.com/tradable_products/vix/vix_historical_data/
    const vixHistory = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const results = [];
    vixHistory.body
        .pipe(
            csv({
                mapHeaders: ({ header, index }) => header.toLowerCase(),
                mapValues: ({ header, index, value }) => {
                    if (header === 'date') {
                        return dayjs(value).format(DATE_FORMAT);
                    }
                    return Number(value);
                },
            }),
        )
        .on('data', (data) => results.push(data))
        .on('end', () => {
            // console.log(results.length);
            // console.log(results[results.length - 1]);
            const closes = [];
            let allPromises = [];
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
                    allPromises.push(db.VIXs.updateOne({ date: vix.date }, vix, { upsert: true }));
                }
            });
            Promise.all(allPromises).then(() => {
                logger.info('finished VIX');
            });
        });
}

async function updateSymbol(symbolSince) {
    return updateSymbolAsync(symbolSince.symbol, symbolSince.since);
}

async function updateSymbolAsync(symbol, since) {
    logger.info(symbol + ' ...');

    let allPromises = [];
    try {
        let overview = await alphavantage.queryCompanyOverview(symbol);
        if (overview.symbol) {
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
        const macds = await alphavantage.queryMACD(symbol, since);
        const rsis = await alphavantage.queryRSI(symbol, 14, since);
        const bbands = await alphavantage.queryBBands(symbol, 20, since);

        for (let i = 0; i < dailyAdjusteds.length; i++) {
            const filter = { symbol: symbol, date: dailyAdjusteds[i].date };
            let ti = filter;

            if (i < sma200s.length) {
                if (
                    sma15s[i].date !== dailyAdjusteds[i].date ||
                    sma20s[i].date !== dailyAdjusteds[i].date ||
                    sma50s[i].date !== dailyAdjusteds[i].date ||
                    sma100s[i].date !== dailyAdjusteds[i].date ||
                    sma200s[i].date !== dailyAdjusteds[i].date ||
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
                    macds[i].date !== dailyAdjusteds[i].date ||
                    rsis[i].date !== dailyAdjusteds[i].date ||
                    bbands[i].date !== dailyAdjusteds[i].date
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
            if (macds[i]) {
                ti.macd = macds[i].macd;
                ti.macdHist = macds[i].hist;
                ti.macdSignal = macds[i].signal;
            }
            if (rsis[i]) ti.rsi = rsis[i].rsi;
            if (bbands[i]) {
                ti.bbandLower = bbands[i].lower;
                ti.bbandUpper = bbands[i].upper;
                ti.bbandMiddle = bbands[i].middle;
            }

            allPromises.push(db.TechnicalIndicators.updateOne(filter, ti, { upsert: true }));
        }

        console.log('all promises ' + symbol, allPromises.length);
        return Promise.all(allPromises);
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
