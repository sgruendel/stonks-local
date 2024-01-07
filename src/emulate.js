'use strict';

// playground don't commit, actual impl. now in emulate_trades.js

const dayjs = require('dayjs');
const logger = require('winston');
const db = require('./db');

const ALL_SYMBOLS = require('./symbols.json');

const DATE_FORMAT = 'YYYY-MM-DD';

let cash = 1000000;
const MIN_BUY = 1000;
const MAX_BUY = 7000;
const TRANSACTION_FEE = 7.9;
const TAX_RATE = 0.25;
let depot = [];
ALL_SYMBOLS.forEach(symbol => { depot[symbol] = { amount: 0, avgSharePrice: 0.0, profit: 0.0 }; });
let transactionFees = 0;
let taxes = 0;

const FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

const filter = (symbol, date) => {
    return {
        symbol: { eq: symbol },
        date: { between: [date.subtract(4, 'day').format(DATE_FORMAT), date.format(DATE_FORMAT)] },
    };
};

const filterAfter = (symbol, date) => {
    return {
        symbol: { eq: symbol },
        date: { between: [date.add(1, 'day').format(DATE_FORMAT), date.add(5, 'day').format(DATE_FORMAT)] },
    };
};

async function getDailyAdjustedFor(symbol, date) {
    const dailyAdjusted = (await db.handleThroughput(filter => db.DailyAdjusted.query(filter).exec(),
        filter(symbol, date))).toJSON();
    return dailyAdjusted.slice(-1)[0];
}

async function getDailyAdjustedAfter(symbol, date) {
    const dailyAdjusted = (await db.handleThroughput(filter => db.DailyAdjusted.query(filter).exec(),
        filterAfter(symbol, date))).toJSON();
    if (dailyAdjusted.length === 0) {
        // on trading after date, so return for last trading day
        return getDailyAdjustedFor(symbol, date);
    }
    return dailyAdjusted[0];
}

async function getTechnicalIndicatorsFor(symbol, date) {
    const tis = (await db.handleThroughput(filter => db.TechnicalIndicators.query(filter).exec(),
        filter(symbol, date))).toJSON();
    if (tis.length < 2) {
        return { tiBefore: undefined, tiCurrent: undefined };
    }
    const tiBefore = tis.slice(-2, -1)[0];
    const tiCurrent = tis.slice(-1)[0];
    return { tiBefore, tiCurrent };
}

async function calcDepot(date) {
    const values = Object.keys(depot).map(async symbol => {
        const amount = depot[symbol].amount;
        return amount === 0 ? 0 : amount * (await getDailyAdjustedFor(symbol, date)).adjustedClose;
    });
    return (await Promise.all(values)).reduce((sum, value) => sum + value);
}

async function buy(date, symbol, dailyAdjusted) {
    const sharePrice = dailyAdjusted.adjustedClose;
    // performs better with rebuying
    /*
    if (depot[symbol].amount > 0 && sharePrice >= depot[symbol].avgSharePrice) {
        console.log('not re-buying ' + symbol + ' at higher price');
        return false;
    }
    */
    if (cash >= MIN_BUY && cash >= sharePrice + TRANSACTION_FEE) {
        const amount = Math.floor(Math.min(MAX_BUY, cash - TRANSACTION_FEE) / sharePrice);
        cash -= (amount * sharePrice) + TRANSACTION_FEE;
        if (depot[symbol].amount > 0) {
            const newAmount = depot[symbol].amount + amount;
            const newAvgSharePrice = (depot[symbol].amount * depot[symbol].avgSharePrice + amount * sharePrice) / newAmount;
            depot[symbol].amount = newAmount;
            depot[symbol].avgSharePrice = newAvgSharePrice;
        } else {
            depot[symbol].amount = amount;
            depot[symbol].avgSharePrice = sharePrice;
        }
        transactionFees += TRANSACTION_FEE;
        console.log('bought ' + amount + ' of ' + symbol + ' on ' + date.format(DATE_FORMAT) + ' for ' + FMT.format(sharePrice)
            + ', now have ' + depot[symbol].amount + ' with avg share price of ' + FMT.format(depot[symbol].avgSharePrice)
            + ', cash is now ' + FMT.format(cash));
        return true;
    } else {
        console.log('cant buy ' + symbol + ' on ' + date.format(DATE_FORMAT) + ' for ' + FMT.format(sharePrice) + ', not enough $ :(');
    }
}

async function sell(date, symbol, dailyAdjusted) {
    const sellPrice = dailyAdjusted.adjustedClose;
    if (sellPrice > depot[symbol].avgSharePrice) {
        const profit = (depot[symbol].amount * sellPrice) - (depot[symbol].amount * depot[symbol].avgSharePrice);
        const tax = (profit > 0) ? profit * TAX_RATE : 0.0;
        cash += (depot[symbol].amount * sellPrice) - TRANSACTION_FEE - tax;
        transactionFees += TRANSACTION_FEE;
        taxes += tax;
        console.log('sold ' + depot[symbol].amount + ' of ' + symbol + ' on ' + date.format(DATE_FORMAT) + ' for ' + FMT.format(sellPrice)
            + ', profit is ' + FMT.format(profit)
            + ', cash is now ' + FMT.format(cash));

        depot[symbol].amount = 0;
        depot[symbol].avgSharePrice = 0.0;
        depot[symbol].profit += profit;
        return true;
    } else {
        console.log('not selling ' + symbol + ' at lower price');
    }
}

async function trade(symbol, date) {
    const dailyAdjustedP = getDailyAdjustedFor(symbol, date);
    const tisP = getTechnicalIndicatorsFor(symbol, date);

    const dailyAdjusted = await dailyAdjustedP;
    const { tiBefore, tiCurrent } = await tisP;

    // only trade if symbol is being traded on 'date', and if we have technical indicators for 'date' and day before
    if (dailyAdjusted && date.isSame(dailyAdjusted.date) && tiBefore && tiCurrent) {
        if (tiCurrent.rsi) {
            if (tiCurrent.rsi <= 30.0) {
                console.log('RSI: buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
            }
            if (tiCurrent.rsi >= 70.0 && depot[symbol].amount > 0) {
                console.log('RSI: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
            }
        }
        /*
        if (bbandsBefore && bbandsCurrent) {
            if (bbandsBefore > bbandsCurrent) {
                //console.log('BBands: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
            }
        }
        */

        let buyIt = false;
        let sellIt = false;
        /*
        both
        cash now is 1,067,215.51
        depot value is 507,990.83
        transaction fees / taxes (already included in cash): 5,192 187,547.75
        */
        /*
        2018-01-01 - 2021-01-14:
        only EMA strategy
            cash now is 804,095.22
            depot value is 2,131,506.99
            transaction fees / taxes (already included in cash): 2,784 145,359.26
        only MACD strategy:
            cash now is 1,416,250.14
            depot value is 436,517.11
            transaction fees / taxes (already included in cash): 10,352 285,176.72
        buy EMA/MACD, sell EMA:
            cash now is 191.09
            depot value is 5,500,172.08
            transaction fees / taxes (already included in cash): 6,888 296,890.34
        buy EMA/MACD, sell MACD:
            cash now is 1,548,916.41
            depot value is 517,517.14
            transaction fees / taxes (already included in cash): 12,296 355,045.35
        buy EMA/MACD, sell EMA/MACD:
            cash now is 1,547,854.37
            depot value is 517,517.14
            transaction fees / taxes (already included in cash): 12,376 354,718.01

        */
        /*
        if (ema12Before && ema12Current && ema50Before && ema50Current) {
            if (ema12Before.ema < ema50Before.ema && ema12Current.ema > ema50Current.ema) {
                // TODO don't buy if RSI says so
                console.log('EMA: buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
                //buyIt = true;
            }
            if (ema12Before.ema > ema50Before.ema && ema12Current.ema < ema50Current.ema) {
                // TODO don't sell if RSI says so
                console.log('EMA: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
                //sellIt = true;
            }
        }
        */
        if (tiBefore.macd && tiCurrent.macd) {
            if (tiBefore.macdHist < 0 && tiCurrent.macdHist > 0) {
                // TODO don't buy if RSI says so
                console.log('MACD: buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
                buyIt = true;
            }
            if (tiBefore.macdHist > 0 && tiCurrent.macdHist < 0 /*&& depot[symbol].amount > 0*/) {
                // TODO don't sell if RSI says so
                console.log('MACD: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
                sellIt = true;
            }

            //schlechtere Logik:
            /*
            if (tiBefore.macdHist < 0 && tiCurrent.macdHist < 0 && tiBefore.macd < tiCurrent.macd) {
                // TODO don't buy if RSI says so
                // only buy initial turnaround
                if (depot[symbol].amount === 0) {
                    console.log('MACD: buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
                    buyIt = true;
                }
            }
            if (tiBefore.macdHist > 0 && tiCurrent.macdHist > 0 && tiBefore.macd > tiCurrent.macd
                && depot[symbol].amount > 0) {

                // TODO don't sell if RSI says so
                console.log('MACD: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
                sellIt = true;
            }*/

            /*
            Siehe https://www.brokerdeal.de/trading-mit-zwei-indikatoren-simpel-und-doch-profitabel/
            scheint cleverer zu sein beim Kaufen, performt aber schlechter
            if (macdBefore.hist < 0 && macdCurrent.hist > 0
                && bbandsBefore.upper < bbandsCurrent.upper
                && dailyAdjusted.adjustedClose > bbandsCurrent.upper && dailyAdjusted.open < bbandsCurrent.upper) {

                // TODO don't buy if RSI says so
                console.log('MACD: buy ' + symbol + ' on ' + date.format(DATE_FORMAT));
                buyIt = true;
            }
            if (macdBefore.hist > 0 && macdCurrent.hist < 0 && depot[symbol].amount > 0) {
                // TODO don't sell if RSI says so
                console.log('MACD: sell ' + symbol + ' on ' + date.format(DATE_FORMAT));
                sellIt = true;
            }
            */

        }

        if (buyIt && !sellIt) {
            return buy(date, symbol, dailyAdjusted);
        } else if (sellIt && !buyIt && depot[symbol].amount > 0) {
            return sell(date, symbol, dailyAdjusted);
        } else if (sellIt && buyIt) {
            console.log('******************************************** lolz');
        }
    }
}

const symbols = ALL_SYMBOLS;
async function calcAll() {
    let date = dayjs('2020-01-01', DATE_FORMAT);
    //let today = dayjs();
    let today = dayjs('2020-12-31', DATE_FORMAT);
    const lastTradingDay = dayjs((await getDailyAdjustedFor(symbols[0], today)).date, DATE_FORMAT);
    console.log('last trading day', lastTradingDay.format(DATE_FORMAT));

    while (date.isBefore(lastTradingDay) || date.isSame(lastTradingDay)) {
        //console.log(date.format(DATE_FORMAT));

        //console.log('getting stock', params);
        /*
        let stocks = SYMBOLS.map(async symbol => {
        const result = await DailyAdjusted.query({ symbol: { eq: symbol }, date: { eq: '2020-12-23' } }).exec();
        //console.log(symbol, result[0]);
        return result[0].toJSON();
        });
        stocks = await Promise.all(stocks);
        */

        if (date.day() >= 1 && date.day() <= 5) {
            // only trade Mon-Fri
            const trades = symbols.map(async symbol => {
                //console.log(symbol);

                try {
                    return await trade(symbol, date);
                } catch (err) {
                    console.error(date.format(DATE_FORMAT) + ' ' + symbol, err);
                }
            });
            await Promise.all(trades);
        }

        date = date.add(1, 'day');
    }

    // calc profit for remaining shares

    await Promise.all(Object.keys(depot).map(async(symbol) => {
        const stock = depot[symbol];
        if (stock.amount > 0) {
            const sellPrice = (await getDailyAdjustedFor(symbol, lastTradingDay)).adjustedClose;
            const profit = stock.amount * (sellPrice - stock.avgSharePrice);
            // const tax = (profit > 0) ? profit * TAX_RATE : 0.0;
            // cash += (depot[symbol].amount * sellPrice) - TRANSACTION_FEE - tax;
            stock.profit += profit;
        }
    }));

    const symbolsByProfit = Object.keys(depot).sort((symbol1, symbol2) => {
        return depot[symbol1].profit < depot[symbol2].profit ? -1
            : (depot[symbol1].profit > depot[symbol2].profit ? 1 : 0);
    });
    console.log('depot:');
    symbolsByProfit.forEach(symbol => {
        let stock = depot[symbol];
        if (stock.profit !== 0) {
            stock.avgSharePrice = stock.avgSharePrice.toFixed(2);
            stock.profit = stock.profit.toFixed(2);
            console.log(symbol, stock);
        }
    });
    console.log('cash now is ' + FMT.format(cash));

    const depotValue = await calcDepot(lastTradingDay);
    console.log('depot value is ' + FMT.format(depotValue));
    console.log('sum of cash+depot is ' + FMT.format(cash + depotValue));
    console.log('transaction fees / taxes (already included in cash):', FMT.format(transactionFees), FMT.format(taxes));
    return;
}

calcAll();
