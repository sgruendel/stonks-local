'use strict';

const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
    ],
    exitOnError: false,
});

const alphavantage = require('./alphavantage');
const db = require('./db');

const ALL_SYMBOLS = require('./symbols.json');

const args = process.argv.slice(2);
const symbols = (args[0] === '*') ? ALL_SYMBOLS : args[0].split(',');
const since = args[1] || '2018-01-01';

logger.info('patching data for ' + symbols + ' since ' + since + ' ...');

symbols.forEach(async symbol => {
    logger.info(symbol + ' ...');

    try {
        const sma20s = await alphavantage.querySMA(symbol, 20, since);
        const sma100s = await alphavantage.querySMA(symbol, 100, since);
        const sma200s = await alphavantage.querySMA(symbol, 200, since);
        const ema20s = await alphavantage.queryEMA(symbol, 20, since);
        const ema100s = await alphavantage.queryEMA(symbol, 100, since);

        logger.info('patching ' + symbol + ': ' + sma20s.length);
        for (let i = 0; i < sma20s.length; i++) {
            let ti = {};

            if (i < sma200s.length) {
                if (sma20s[i].date !== sma100s[i].date
                    || sma200s[i].date !== sma20s[i].date
                    || ema20s[i].date !== sma20s[i].date
                    || ema100s[i].date !== sma20s[i].date) {

                    throw new Error('diff. date ' + symbol);
                }
            }
            if (sma20s[i]) ti.sma20 = sma20s[i].sma;
            if (sma100s[i]) ti.sma200 = sma100s[i].sma;
            if (sma200s[i]) ti.sma200 = sma200s[i].sma;
            if (ema20s[i]) ti.ema20 = ema20s[i].ema;
            if (ema100s[i]) ti.ema100 = ema100s[i].ema;

            if (Object.getOwnPropertyNames(ti).length >= 1) {
                const date = sma20s[i].date;
                await db.handleThroughput(
                    params => db.TechnicalIndicators.update(params.key, params.updateTI),
                    { key: { symbol, date }, updateTI: ti });
            }
        }
    } catch (err) {
        logger.error(symbol, err);
    }
});
