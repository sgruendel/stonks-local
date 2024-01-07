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

const db = require('./db');

const filterBefore = (symbol, date) => {
    return {
        symbol: symbol,
        date: { $lt: date },
    };
};

async function fixSplit(symbol, date) {
    const dailyAdjustedOnSplitDate = (await db.DailyAdjusted.find({ symbol, date }).exec())[0];
    //console.log(dailyAdjusted);
    if (dailyAdjustedOnSplitDate.splitCoefficient === 1) {
        throw new Error('split coefficient must be other than 1');
    }
    const splitCoefficient = dailyAdjustedOnSplitDate.splitCoefficient;
    console.log(dailyAdjustedOnSplitDate);

    const dailyAdjusteds = await db.DailyAdjusted.find(filterBefore(symbol, date)).exec();
    console.log(dailyAdjusteds.length);

    /*
        const values = Object.keys(depot).map(async symbol => {
        const amount = depot[symbol].amount;
        return amount === 0 ? 0 : amount * (await getDailyAdjustedFor(symbol, date)).adjustedClose;
    });
    return (await Promise.all(values)).reduce((sum, value) => sum + value);

    */
    const updates = dailyAdjusteds.map(async dailyAdjusted => {
        const da = {
            open: Number((dailyAdjusted.open / splitCoefficient).toFixed(4)),
            close: Number((dailyAdjusted.close / splitCoefficient).toFixed(4)),
            high: Number((dailyAdjusted.high / splitCoefficient).toFixed(4)),
            low: Number((dailyAdjusted.low / splitCoefficient).toFixed(4)),
        };
        if (da.close !== dailyAdjusted.adjustedClose.toFixed(4)) {
            //logger.error(da.close + '/' + dailyAdjusted.adjustedClose);
        }
        //return db.DailyAdjusted.updateOne({ symbol: symbol, date: dailyAdjusted.date }, da);
    });

    await Promise.all(updates);
    logger.info('done, waiting to finish ...');
    db.disconnect();
}

const args = process.argv.slice(2);
const symbol = args[0];
const splitDate = args[1];

logger.info(`fixing split for ${symbol} on ${splitDate} ...`);
fixSplit(symbol, splitDate);
