import fs from 'fs';
import dayjs from 'dayjs';
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

import * as db from './db.js';

/** entry for stock in depot
 * @typedef DepotEntry
 * @type {object}
 * @property {number} amount amount of stock in depot
 * @property {number} avgSharePrice average share price
 * @property {number} daysSinceBuy days since last buy
 * @property {number} profit profit taken so far
 * @property {number} profitTarget profit target
 * @property {number} redDaysSinceBuy red days since last buy
 * @property {number} stopLoss stop loss
 */

/**
 * @callback BuyItFn
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @param {db.VIX[]} vixs VIX data
 * @returns {boolean} true if buy signal
 */

/**
 * @callback SellItFn
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @param {db.VIX[]} vixs VIX data
 * @returns {boolean} true if sell signal
 */

/** @type {string[]} */
const ALL_SYMBOLS = JSON.parse(fs.readFileSync('src/symbols.json').toString());
const DATE_FORMAT = 'YYYY-MM-DD';

let cash = 1000000;
const MIN_BUY = 1000;
const MAX_BUY = 5000;
const TRANSACTION_FEE = 0.0;
const TAX_RATE = 0.25;

/** @type {Object.<string, DepotEntry>} */
let depot = {};
ALL_SYMBOLS.forEach((symbol) => {
    depot[symbol] = {
        amount: 0,
        avgSharePrice: 0.0,
        profit: 0.0,
        daysSinceBuy: 0,
        profitTarget: 0.0,
        redDaysSinceBuy: 0,
        stopLoss: 0.0,
    };
});

let transactionFees = 0;
let taxes = 0;

// Has symbol closed below sma50 previously?
/** @type {Object.<string, boolean>} */
let closedBelowSma50 = {};

// Last 20 daily lows for symbol
/** @type {Object.<string, number[]>} */
let lows = {};
ALL_SYMBOLS.forEach((symbol) => {
    lows[symbol] = [];
});

/**
 *
 * @param {string} symbol stock symbol
 * @returns number | undefined
 */
const swingLow = (symbol) => {
    return lows[symbol].length === 0 ? undefined : Math.min(...lows[symbol]);
};

const FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/**
 *
 * @param {string} symbol stock symbol
 * @param {dayjs.Dayjs} date date
 * @returns {{symbol: string, date: Object}}
 */
const filterOnOrBefore = (symbol, date) => {
    return {
        symbol: symbol,
        date: { $lte: date.format(DATE_FORMAT) },
    };
};

/**
 *
 * @param {string} symbol
 * @param {dayjs.Dayjs} date
 * @returns {Promise<db.DailyAdjusted>}
 */
async function getDailyAdjustedFor(symbol, date) {
    const dailyAdjusted = await db.DailyAdjusted.find(filterOnOrBefore(symbol, date))
        .limit(1)
        .sort({ date: 'desc' })
        .exec();
    return dailyAdjusted[0];
}

/**
 *
 * @param {string} symbol
 * @param {dayjs.Dayjs} date
 * @returns {Promise<{tiBefore: db.TechnicalIndicators | undefined, tiCurrent: db.TechnicalIndicators | undefined}>}
 */
async function getTechnicalIndicatorsFor(symbol, date) {
    /** @type {db.TechnicalIndicators[]} */
    // @ts-ignore
    const tis = await db.TechnicalIndicators.find(filterOnOrBefore(symbol, date))
        .limit(2)
        .sort({ date: 'desc' })
        .exec();
    return {
        tiBefore: tis.length >= 2 ? tis[1] : undefined,
        tiCurrent: tis.length >= 1 ? tis[0] : undefined,
    };
}

/**
 *
 * @param {dayjs.Dayjs} date
 * @returns {Promise<db.VIX[]>}
 */
async function getVIXsFor(date) {
    /** @type {db.VIX[]} */
    // @ts-ignore
    const vixs = await db.VIXs.find({ date: { $lte: date.format(DATE_FORMAT) } })
        .limit(2)
        .sort({ date: 'desc' })
        .exec();
    return vixs;
}

/**
 *
 * @param {dayjs.Dayjs} date
 * @returns {Promise<number>} depot value
 */
async function calcDepot(date) {
    const values = Object.keys(depot).map(async (symbol) => {
        const amount = depot[symbol].amount;
        return amount === 0 ? 0 : amount * (await getDailyAdjustedFor(symbol, date)).adjustedClose;
    });
    return (await Promise.all(values)).reduce((sum, value) => sum + value);
}

/**
 *
 * @param {dayjs.Dayjs} date trading day
 * @param {string} symbol stock symbol
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @returns {Promise<boolean>} true if bought
 */
async function buy(date, symbol, dailyAdjusted) {
    const sharePrice = dailyAdjusted.adjustedClose;
    // performs better with rebuying
    if (depot[symbol].amount > 0 && sharePrice >= depot[symbol].avgSharePrice) {
        logger.info('not re-buying ' + symbol + ' at higher price');
        return false;
    }
    if (cash >= MIN_BUY && cash >= sharePrice + TRANSACTION_FEE) {
        const amount = Math.floor(Math.min(MAX_BUY, cash - TRANSACTION_FEE) / sharePrice);
        cash -= amount * sharePrice + TRANSACTION_FEE;
        if (depot[symbol].amount > 0) {
            const newAmount = depot[symbol].amount + amount;
            const newAvgSharePrice =
                (depot[symbol].amount * depot[symbol].avgSharePrice + amount * sharePrice) / newAmount;
            depot[symbol].amount = newAmount;
            depot[symbol].avgSharePrice = newAvgSharePrice;
        } else {
            depot[symbol].amount = amount;
            depot[symbol].avgSharePrice = sharePrice;
        }
        /*
        pre tax back:
        info: cash now is 1.008.156,3
info: depot value is 0
info: sum of cash+depot is 1.008.156,3
info: transaction fees / taxes (already included in cash): 15.225/64.634,97
        */
        transactionFees += TRANSACTION_FEE;
        logger.info(
            'bought ' +
                amount +
                ' of ' +
                symbol +
                ' on ' +
                date.format(DATE_FORMAT) +
                ' for ' +
                FMT.format(sharePrice) +
                ', now have ' +
                depot[symbol].amount +
                ' with avg share price of ' +
                FMT.format(depot[symbol].avgSharePrice) +
                ', cash is now ' +
                FMT.format(cash),
        );
        return true;
    } else {
        logger.info(
            'can\'t buy ' +
                symbol +
                ' on ' +
                date.format(DATE_FORMAT) +
                ' for ' +
                FMT.format(sharePrice) +
                ', not enough $ :(',
        );
    }
}

/**
 *
 * @param {dayjs.Dayjs} date trading day
 * @param {string} symbol stock symbol
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @param {boolean} force
 * @param {number} sellPrice
 * @returns {Promise<boolean>} true if sold
 */
async function sell(date, symbol, dailyAdjusted, force = false, sellPrice = undefined) {
    if (depot[symbol].amount > 0) {
        if (sellPrice) {
            logger.info('selling for ' + sellPrice + ' instead of ' + dailyAdjusted.adjustedClose);
        } else {
            sellPrice = dailyAdjusted.adjustedClose;
        }
        if (force || sellPrice > depot[symbol].avgSharePrice) {
            const profit = depot[symbol].amount * sellPrice - depot[symbol].amount * depot[symbol].avgSharePrice;
            const tax = profit * TAX_RATE;
            cash += depot[symbol].amount * sellPrice - TRANSACTION_FEE - tax;
            transactionFees += TRANSACTION_FEE;
            taxes += tax;
            logger.info(
                'sold ' +
                    depot[symbol].amount +
                    ' of ' +
                    symbol +
                    ' on ' +
                    date.format(DATE_FORMAT) +
                    ' for ' +
                    FMT.format(sellPrice) +
                    ', profit is ' +
                    FMT.format(profit) +
                    ', cash is now ' +
                    FMT.format(cash),
            );

            depot[symbol].amount = 0;
            depot[symbol].avgSharePrice = 0.0;
            depot[symbol].profit += profit;
            depot[symbol].stopLoss = undefined;
            depot[symbol].profitTarget = undefined;
            return true;
        } else {
            logger.info('not selling ' + symbol + ' at lower price');
        }
    }
}

/**
 *
 * @param {DepotEntry} depot
 * @param {number} splitCoefficient
 */
function splitAdjust(depot, splitCoefficient) {
    if (depot) {
        logger.info('before split adjust', depot);
        depot.amount *= splitCoefficient;
        depot.avgSharePrice /= splitCoefficient;
        depot.profitTarget /= splitCoefficient;
        depot.stopLoss /= splitCoefficient;
        logger.info('after split adjust', depot);
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if buy signal
 */
function buyItMacd(tiBefore, tiCurrent) {
    if (tiBefore.macd && tiCurrent.macd) {
        if (tiBefore.macd < 0 && tiCurrent.macd > 0) {
            // TODO don't buy if RSI <50
            // TODO only if above SMA50/SMA200?
            return true;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if sell signal
 */
function sellItMacd(tiBefore, tiCurrent) {
    if (tiBefore.macd && tiCurrent.macd) {
        if (tiBefore.macd > 0 && tiCurrent.macd < 0) {
            // TODO don't sell if RSI >50
            return true;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if buy signal
 */
function buyItMacdHist(tiBefore, tiCurrent) {
    if (tiBefore.macd && tiCurrent.macd) {
        if (tiBefore.macdHist < 0 && tiCurrent.macdHist > 0) {
            // TODO only buy if MACD < 0
            // TODO don't buy if RSI <50
            // TODO only if above SMA50 or EMA100
            return true; //tiCurrent.macd < 2.0 && tiCurrent.rsi < 50.0*/;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if sell signal
 */
function sellItMacdHist(tiBefore, tiCurrent) {
    // TODO sell if below SMA50?
    if (tiBefore.macd && tiCurrent.macd) {
        if (tiBefore.macdHist > 0 && tiCurrent.macdHist < 0) {
            // TODO only sell if MACD > 0
            // TODO don't sell if RSI >50
            return true; //tiCurrent.macd > -2.0 /*&& tiCurrent.rsi > 50.0*/;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @returns {boolean} true if buy signal
 */
function buyItBB(tiBefore, tiCurrent, dailyAdjusted) {
    if (tiBefore.bbandUpper && tiCurrent.bbandUpper) {
        if (tiBefore.bbandUpper > tiCurrent.bbandUpper && tiBefore.bbandLower < tiCurrent.bbandLower) {
            // TODO only buy if MACD < 0
            // TODO don't buy if RSI <50
            // TODO only if above SMA50 or EMA100
            return dailyAdjusted.adjustedClose < tiCurrent.bbandLower;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @returns {boolean} true if sell signal
 */
function sellItBB(tiBefore, tiCurrent, dailyAdjusted) {
    if (tiBefore.bbandUpper && tiCurrent.bbandUpper) {
        if (tiBefore.bbandUpper < tiCurrent.bbandUpper && tiBefore.bbandLower > tiCurrent.bbandLower) {
            // TODO only buy if MACD < 0
            // TODO don't buy if RSI <50
            // TODO only if above SMA50 or EMA100
            return (
                dailyAdjusted.adjustedClose > tiBefore.bbandUpper && dailyAdjusted.adjustedClose < tiCurrent.bbandUpper
            );
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if buy signal
 */
function buyItRSI(tiBefore, tiCurrent) {
    if (tiBefore.rsi && tiCurrent.rsi) {
        if (tiBefore.rsi < tiCurrent.rsi && tiBefore.rsi < 33.0) {
            // TODO only if above SMA50 or EMA100
            // TODO only if not a red day (close > open)
            // TODO only if lower (upper?) BBBand is rising
            // TODO dailyAdjusted.adjustedClose > tiCurrent.bbandLower;
            return true; //tiBefore.bbandUpper < tiCurrent.bbandUpper;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @returns {boolean} true if sell signal
 */
function sellItRSI(tiBefore, tiCurrent) {
    if (tiBefore.rsi && tiCurrent.rsi) {
        if (tiBefore.rsi > tiCurrent.rsi && tiBefore.rsi > 70.0) {
            return true;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @returns {boolean} true if buy signal
 */
function buyItEMACloud2(tiBefore, tiCurrent, dailyAdjusted) {
    if (tiBefore.ema13 && tiCurrent.ema13) {
        if (tiCurrent.ema13 < tiCurrent.ema5 && tiBefore.ema5 < tiCurrent.ema5) {
            return dailyAdjusted.adjustedClose > tiCurrent.ema5;
        }
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @returns {boolean} true if sell signal
 */
function sellItEMACloud2(tiBefore, tiCurrent, dailyAdjusted) {
    if (tiBefore.ema13 && tiCurrent.ema13) {
        // take profit if dailyAdjusted.low < tiBefore.ema13
        if (dailyAdjusted.low < tiBefore.ema13) {
            return tiBefore.ema13;
        }

        if (tiBefore.ema13 > tiCurrent.ema13) {
            // if (tiCurrent.ema13 > tiCurrent.ema5 && tiBefore.ema13 > tiCurrent.ema13) {
            if (dailyAdjusted.adjustedClose < tiCurrent.ema13) {
                // throw Error('should never happen: ' + dailyAdjusted.low + '/' + dailyAdjusted.adjustedClose + '/' + tiCurrent.ema13);
                return dailyAdjusted.adjustedClose;
            }
        }
    }
}

// see http://www.traderslaboratory.com/forums/topic/6931-combining-rsi-and-vix-into-a-winning-system/
/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @param {db.VIX[]} vixs VIX data
 * @returns {boolean} true if sell signal
 */
function buyItVIXStrechStrategy(tiBefore, tiCurrent, dailyAdjusted, vixs) {
    if (dailyAdjusted.adjustedClose > tiCurrent.ema200) {
        // TODO only if above SMA50 or EMA100
        // TODO only if not a red day (close > open)
        // TODO only if lower (upper?) BBBand is rising
        // TODO dailyAdjusted.adjustedClose > tiCurrent.bbandLower;
        // return true;//tiBefore.bbandUpper < tiCurrent.bbandUpper;
        return vixs[0].close >= vixs[0].sma10 * 1.05 && vixs[1].close >= vixs[1].sma10 * 1.05;
    }
}

/**
 *
 * @param {db.TechnicalIndicators} tiBefore technical indicators for previous trading day
 * @param {db.TechnicalIndicators} tiCurrent technical indicators for current trading day
 * @param {db.DailyAdjusted} dailyAdjusted daily adjusted data
 * @param {db.VIX[]} vixs VIX data
 * @returns {boolean} true if sell signal
 */
function sellItVIXStrechStrategy(tiBefore, tiCurrent, dailyAdjusted, vixs) {
    // TODO: 2-period RSI
    if (tiBefore.rsi && tiCurrent.rsi) {
        if (tiBefore.rsi > tiCurrent.rsi && tiBefore.rsi > 65.0) {
            return true;
        }
    }
}

/**
 *
 * @param {string} symbol
 * @param {dayjs.Dayjs} date
 * @param {db.VIX[]} vixs
 * @param {BuyItFn} buyItFn
 * @param {SellItFn} sellItFn
 * @param {string} strategy
 * @returns {Promise<boolean>} true if trade was successful
 */
async function trade(symbol, date, vixs, buyItFn, sellItFn, strategy) {
    const dailyAdjustedP = getDailyAdjustedFor(symbol, date);
    const tisP = getTechnicalIndicatorsFor(symbol, date);

    const dailyAdjusted = await dailyAdjustedP;
    const { tiBefore, tiCurrent } = await tisP;

    // only trade if symbol is being traded on 'date', and if we have technical indicators for 'date' and day before
    if (dailyAdjusted && date.isSame(dailyAdjusted.date) && tiBefore && tiCurrent) {
        if (tiBefore.rsi && tiCurrent.rsi) {
            if (tiBefore.rsi < 30.0 && tiCurrent.rsi >= 30.0) {
                logger.info('RSI: ' + symbol + ' bullish, leaving oversold on ' + date.format(DATE_FORMAT));
            } else if (tiBefore.rsi > 70.0 && tiCurrent.rsi <= 70.0 && depot[symbol].amount > 0) {
                logger.info('RSI: ' + symbol + ' bearish, leaving overbought on ' + date.format(DATE_FORMAT));
            }
        }

        if (tiBefore.sma200 && tiCurrent.sma200) {
            if (tiBefore.sma50 < tiBefore.sma200 && tiCurrent.sma50 > tiCurrent.sma200) {
                logger.info('GoldenCross: ' + symbol + ' bullish on ' + date.format(DATE_FORMAT));
            } else if (tiBefore.sma50 > tiBefore.sma200 && tiCurrent.sma50 < tiCurrent.sma200) {
                logger.info('DeathCross: ' + symbol + ' bearish on ' + date.format(DATE_FORMAT));
            }
        }

        if (dailyAdjusted.adjustedClose < tiCurrent.sma50) {
            if (!closedBelowSma50[symbol]) {
                // only log first one of consecutive drops below sma50
                logger.info('SMA50: ' + symbol + ' bearish on ' + date.format(DATE_FORMAT));
            }
            closedBelowSma50[symbol] = true;
        } else {
            closedBelowSma50[symbol] = false;
        }

        let sellPrice = 0.0;

        /*
        if (depot[symbol].amount) {
            if (depot[symbol].stopLoss && dailyAdjusted.low < depot[symbol].stopLoss) {
                sellPrice = depot[symbol].stopLoss;
                logger.info('stop loss: ' + symbol + ' selling on ' + date.format(DATE_FORMAT));
            } else if (depot[symbol].profitTarget && dailyAdjusted.adjustedClose > depot[symbol].profitTarget) {
                sellPrice = depot[symbol].profitTarget;
                logger.info('profit target: ' + symbol + ' selling on ' + date.format(DATE_FORMAT));
            }
        }
        */

        /*
        if (depot[symbol].amount) {
            depot[symbol].daysSinceBuy++;
            if (dailyAdjusted.adjustedClose < dailyAdjusted.open) {
                depot[symbol].redDaysSinceBuy++;
            }
            if (depot[symbol].daysSinceBuy === 3 && depot[symbol].redDaysSinceBuy === 3) {
                sellIt = true;
                logger.info('three red days in a row: ' + symbol + ' selling on ' + date.format(DATE_FORMAT));
            }
        }
        */

        let result = false;
        if (sellPrice > 0.0) {
            result = await sell(date, symbol, dailyAdjusted, true, sellPrice);
        } else {
            const buyIt = buyItFn(tiBefore, tiCurrent, dailyAdjusted, vixs);
            const sellIt = sellItFn(tiBefore, tiCurrent, dailyAdjusted, vixs);
            // TODO Gewinnmitnahme / stop loss via ATR: https://broker-test.de/trading-news/modifizierter-macd-und-die-average-true-range-35691/

            if (buyIt && !sellIt) {
                // always buy with EMA Clouds, even if sell signal is true
                logger.info(strategy + ': buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
                result = await buy(date, symbol, dailyAdjusted);
                if (result) {
                    depot[symbol].daysSinceBuy = 0;
                    depot[symbol].redDaysSinceBuy = 0;
                    const newStopLoss = swingLow(symbol); // TODO stop loss should be significantly lower than buy price
                    logger.info(
                        symbol + ': current stop loss is ' + depot[symbol].stopLoss + ', new is ' + newStopLoss,
                    );
                    if (!depot[symbol].stopLoss || newStopLoss < depot[symbol].stopLoss) {
                        depot[symbol].stopLoss = newStopLoss;
                        depot[symbol].profitTarget = 1.5 * depot[symbol].stopLoss;
                        logger.info(
                            symbol +
                                ': stop loss now ' +
                                depot[symbol].stopLoss +
                                ', profit target ' +
                                depot[symbol].profitTarget,
                        );
                    }
                }
            } else if (sellIt && !buyIt) {
                if (depot[symbol].amount > 0) {
                    logger.info(strategy + ': sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
                }
                result = await sell(date, symbol, dailyAdjusted, false);
            } else if (sellIt && buyIt) {
                // shouldn't really happen
                logger.error(
                    date.format(DATE_FORMAT) +
                        ': ' +
                        symbol +
                        ' ambigous signals: ' +
                        tiCurrent.ema5 +
                        '/' +
                        dailyAdjusted.adjustedClose +
                        '/' +
                        dailyAdjusted.low +
                        '/' +
                        tiCurrent.ema13,
                );
            }
        }

        if (dailyAdjusted.splitCoefficient !== 1) {
            logger.info(symbol + ': split ' + dailyAdjusted.splitCoefficient);
            logger.info(symbol + ': lows ', lows[symbol]);
            splitAdjust(depot[symbol], dailyAdjusted.splitCoefficient);
        }

        // TODO low doesn't consider split, need an adjustedLow: lows[symbol].push(dailyAdjusted.low);
        // so for now, use adjustedClose as low
        lows[symbol].push(dailyAdjusted.adjustedClose);
        if (lows[symbol].length > 20) {
            lows[symbol].shift();
            /*
            if (symbol === 'TTD') {
                logger.info(symbol + ': lows ', lows[symbol]);
            }
            */
        }
        /*
        if (dailyAdjusted.splitCoefficient !== 1) {
            logger.info(symbol + ': lows ', lows[symbol]);
        }
        */

        return result;
    }
}

/**
 * emulate trades for symbols from fromDate to toDate using specific strategy
 *
 * @param {string[]} symbols
 * @param {dayjs.Dayjs} fromDate
 * @param {dayjs.Dayjs} toDate
 * @param {string} strategy
 */
async function emulateTrades(symbols, fromDate, toDate, strategy) {
    const lastTradingDate = dayjs((await getDailyAdjustedFor(symbols[0], toDate)).date, DATE_FORMAT);
    logger.info('last trading day is ' + lastTradingDate.format(DATE_FORMAT));

    let date = fromDate;
    while (date.isBefore(lastTradingDate) || date.isSame(lastTradingDate)) {
        if (date.day() >= 1 && date.day() <= 5) {
            // only trade Mon-Fri
            const vixs = await getVIXsFor(date);
            const trades = symbols.map(async (symbol) => {
                try {
                    switch (strategy) {
                        case 'MACD':
                            return await trade(symbol, date, vixs, buyItMacd, sellItMacd, 'MACD');

                        case 'MACD-Hist':
                            // since 2019 info: cash now is 455.807,19
                            // since 2019 info: depot value is 1.732.066,21
                            // since 2019 info: sum of cash+depot is 2.187.873,4
                            // since 2019 info: transaction fees / taxes (already included in cash): 3.675/-33.051,02
                            return await trade(symbol, date, vixs, buyItMacdHist, sellItMacdHist, 'MACD-Hist');

                        case 'BB':
                            return await trade(symbol, date, vixs, buyItBB, sellItBB, 'BB');

                        case 'RSI':
                            // since 2019 info: cash now is 334.793,24
                            // since 2019 info: depot value is 1.703.523,4
                            // since 2019 info: sum of cash+depot is 2.038.316,64
                            // since 2019 info: transaction fees / taxes (already included in cash): 9.485/-29.856,94
                            return await trade(symbol, date, vixs, buyItRSI, sellItRSI, 'RSI');

                        case 'EMA2':
                            // since 2019 info: cash now is 1.477.632,19
                            // since 2019 info: depot value is 164.237,88
                            // since 2019 info: sum of cash+depot is 1.641.870,07
                            // since 2019 info: transaction fees / taxes (already included in cash): 35.644/225.718,47
                            return await trade(symbol, date, vixs, buyItEMACloud2, sellItEMACloud2, 'EMA2');

                        case 'VIXss':
                            // since 2019 info: cash now is 386.861,74
                            // since 2019 info: depot value is 1.205.979,24
                            // since 2019 info: sum of cash+depot is 1.592.840,98
                            // since 2019 info: transaction fees / taxes (already included in cash): 3.654/-36.553,26
                            return await trade(
                                symbol,
                                date,
                                vixs,
                                buyItVIXStrechStrategy,
                                sellItVIXStrechStrategy,
                                'VIXss',
                            );

                        default:
                            throw new Error('unknown strategy ' + strategy);
                    }
                } catch (err) {
                    logger.error(date.format(DATE_FORMAT) + ' ' + symbol, err);
                }
            });
            logger.info(''); // empty line to separate days
            await Promise.all(trades);
        }

        date = date.add(1, 'day');
    }

    // calc profit for remaining shares

    await Promise.all(
        Object.keys(depot).map(async (symbol) => {
            const stock = depot[symbol];
            if (stock.amount > 0) {
                const sellPrice = (await getDailyAdjustedFor(symbol, lastTradingDate)).adjustedClose;
                const profit = stock.amount * (sellPrice - stock.avgSharePrice);
                // const tax = (profit > 0) ? profit * TAX_RATE : 0.0;
                // cash += (depot[symbol].amount * sellPrice) - TRANSACTION_FEE - tax;
                stock.profit += profit;
            }
        }),
    );

    const symbolsByProfit = Object.keys(depot).sort((symbol1, symbol2) => {
        return depot[symbol1].profit < depot[symbol2].profit
            ? -1
            : depot[symbol1].profit > depot[symbol2].profit
            ? 1
            : 0;
    });

    logger.info('depot (past):');
    symbolsByProfit.forEach((symbol) => {
        const stock = depot[symbol];
        if (stock.amount === 0 && stock.profit !== 0) {
            stock.avgSharePrice = Number(stock.avgSharePrice.toFixed(2));
            stock.profit = Number(stock.profit.toFixed(2));
            logger.info(symbol, stock);
        }
    });

    logger.info('depot (current):');
    symbolsByProfit.forEach((symbol) => {
        const stock = depot[symbol];
        if (stock.amount > 0) {
            stock.avgSharePrice = Number(stock.avgSharePrice.toFixed(2));
            stock.profit = Number(stock.profit.toFixed(2));
            logger.info(symbol, stock);
        }
    });

    logger.info('cash now is ' + FMT.format(cash));

    const depotValue = await calcDepot(lastTradingDate);
    logger.info('depot value is ' + FMT.format(depotValue));
    logger.info('sum of cash+depot is ' + FMT.format(cash + depotValue));
    logger.info(
        'transaction fees / taxes (already included in cash): ' + FMT.format(transactionFees) + '/' + FMT.format(taxes),
    );

    logger.info('done, waiting to finish ...');
    db.disconnect();
}

const args = process.argv.slice(2);
const symbols = args[0] === '*' ? ALL_SYMBOLS : args[0].split(',');
const from = args[1] || dayjs().subtract(7, 'days').format(DATE_FORMAT);
const to = args[2] || dayjs().format(DATE_FORMAT);
const strategy = args[3] || 'MACD';

logger.info(`emulating trades for ${symbols} from ${from} to ${to} using strategy ${strategy} ...`);
emulateTrades(symbols, dayjs(from, DATE_FORMAT), dayjs(to, DATE_FORMAT), strategy);
