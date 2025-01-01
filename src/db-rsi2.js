import fs from 'fs';
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

const args = process.argv.slice(2);
const symbols = args[0] === '*' ? ALL_SYMBOLS : args[0].split(',');
const since = args[1] || '2018-01-01';

logger.info('adding rsi2 for ' + symbols + ' since ' + since + ' ...');

db.TechnicalIndicator.collection.updateMany(
    {},
    {
        $rename: { rsi: 'rsi14' },
    },
);

async function updateSymbol(symbol) {
    logger.info(symbol + ' ...');

    try {
        const rsi2s = await alphavantage.queryRSI(symbol, 2, since);

        logger.info('patching ' + symbol + ': ' + rsi2s.length);
        for (let i = 0; i < rsi2s.length; i++) {
            let ti = {};

            ti.rsi2 = rsi2s[i].rsi;

            if (Object.getOwnPropertyNames(ti).length >= 1) {
                const date = rsi2s[i].date;
                await db.handleThroughput((params) => db.TechnicalIndicator.updateOne(params.key, params.updateTI), {
                    key: { symbol, date },
                    updateTI: ti,
                });
            }
        }
    } catch (err) {
        logger.error(symbol, err);
    }
}

pMap(
    symbols.map((symbol) => symbol),
    updateSymbol,
    { concurrency: 1, stopOnError: false },
).then(() => {
    logger.info('done, waiting to finish ...');
    db.disconnect();
});
