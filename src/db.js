import mongoose from 'mongoose';
import winston from 'winston';

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'debug',
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
    ],
    exitOnError: false,
});

mongoose.connect('mongodb://localhost:27017/stonks');

export { disconnect } from 'mongoose';

// see https://github.com/dynamoose/dynamoose/issues/209#issuecomment-374258965
export async function handleThroughput(callback, params, attempt = 1) {
    const BACK_OFF = 500; // back off base time in millis
    const CAP = 10000; // max. back off time in millis

    try {
        return await callback(params);
    } catch (e) {
        if (e.code === 'ProvisionedThroughputExceededException') {
            // exponential backoff with jitter,
            // see https://aws.amazon.com/de/blogs/architecture/exponential-backoff-and-jitter/
            const temp = Math.min(CAP, BACK_OFF * Math.pow(2, attempt));
            const sleep = temp / 2 + Math.floor((Math.random() * temp) / 2);
            logger.debug('MongoDB: sleeping for ' + sleep + ' on attempt ' + attempt + ', temp ' + temp);
            await new Promise((resolve) => setTimeout(resolve, sleep));
            return handleThroughput(callback, params, ++attempt);
        } else throw e;
    }
}

const companyOverview = new mongoose.Schema(
    {
        symbol: {
            type: String,
            validate: (symbol) => symbol.length > 0,
            required: true,
        },
        date: {
            type: String,
            validate: (date) => date.length > 0,
            required: true,
        },
    },
    {
        autoCreate: true,
        strict: false,
        timestamps: true,
    },
);
export const CompanyOverview = mongoose.model('CompanyOverview', companyOverview);
companyOverview.index({ symbol: 1, date: -1 });

/** daily adjusted stock data
 * @typedef DailyAdjusted
 * @type {object}
 * @property {string} symbol stock symbol
 * @property {string} date date of stock data
 * @property {number} open open price
 * @property {number} high high price
 * @property {number} low low price
 * @property {number} close close price
 * @property {number} adjustedClose adjusted close price
 * @property {number} volume volume traded on date
 * @property {number} dividendAmount dividend amount paid on date
 * @property {number} splitCoefficient split coefficient on date
 */
const dailyAdjusted = new mongoose.Schema(
    {
        symbol: {
            type: String,
            validate: (symbol) => symbol.length > 0,
            required: true,
        },
        date: {
            type: String,
            validate: (date) => date.length > 0,
            required: true,
        },
        open: {
            type: Number,
            validate: (open) => open >= 0,
            required: true,
        },
        high: {
            type: Number,
            validate: (high) => high >= 0,
            required: true,
        },
        low: {
            type: Number,
            validate: (low) => low >= 0,
            required: true,
        },
        close: {
            type: Number,
            validate: (close) => close >= 0,
            required: true,
        },
        adjustedClose: {
            type: Number,
            validate: (adjustedClose) => adjustedClose >= 0,
            required: true,
        },
        volume: {
            type: Number,
            validate: (volume) => volume >= 0,
            required: true,
        },
        dividendAmount: {
            type: Number,
            validate: (dividendAmount) => dividendAmount >= 0,
            required: true,
        },
        splitCoefficient: {
            type: Number,
            validate: (splitCoefficient) => splitCoefficient >= 0,
            required: true,
        },
    },
    {
        autoCreate: true,
        timestamps: true,
    },
);
dailyAdjusted.index({ symbol: 1, date: -1 });
export const DailyAdjusted = mongoose.model('DailyAdjusted', dailyAdjusted);

/** technical indicators for stock
 * @typedef TechnicalIndicator
 * @type {object}
 * @property {string} symbol stock symbol
 * @property {string} date date of technical indicators
 * @property {number} sma15 simple moving average over 15 days
 * @property {number} sma20 simple moving average over 20 days
 * @property {number} sma50 simple moving average over 50 days
 * @property {number} sma100 simple moving average over 100 days
 * @property {number} sma200 simple moving average over 200 days
 * @property {number} ema5 exponential moving average over 5 days
 * @property {number} ema8 exponential moving average over 8 days
 * @property {number} ema9 exponential moving average over 9 days
 * @property {number} ema12 exponential moving average over 12 days
 * @property {number} ema13 exponential moving average over 13 days
 * @property {number} ema20 exponential moving average over 20 days
 * @property {number} ema21 exponential moving average over 21 days
 * @property {number} ema26 exponential moving average over 26 days
 * @property {number} ema34 exponential moving average over 34 days
 * @property {number} ema50 exponential moving average over 50 days
 * @property {number} ema100 exponential moving average over 100 days
 * @property {number} ema200 exponential moving average over 200 days
 * @property {number} macd moving average convergence divergence
 * @property {number} macdHist moving average convergence divergence histogram
 * @property {number} macdSignal moving average convergence divergence signal
 * @property {number} rsi2 relative strength index over 2 days
 * @property {number} rsi14 relative strength index over 14 days
 * @property {number} bbandLower lower bollinger band
 * @property {number} bbandUpper upper bollinger band
 * @property {number} bbandMiddle middle bollinger band
 * @property {number} atr14 average true range over 14 days
 * @property {number} natr14 normalized average true range over 14 days
 */

const technicalIndicator = new mongoose.Schema(
    {
        symbol: {
            type: String,
            validate: (symbol) => symbol.length > 0,
            required: true,
        },
        date: {
            type: String,
            validate: (date) => date.length > 0,
            required: true,
        },
        sma15: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma20: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma50: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma100: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma200: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        ema5: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema8: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema9: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema12: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema13: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema20: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema21: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema26: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema34: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema50: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema100: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        ema200: {
            type: Number,
            validate: (ema) => ema >= 0,
        },
        macd: {
            type: Number,
        },
        macdHist: {
            type: Number,
        },
        macdSignal: {
            type: Number,
        },
        rsi2: {
            type: Number,
            validate: (rsi) => rsi >= 0.0 && rsi <= 100.0,
        },
        rsi14: {
            type: Number,
            validate: (rsi) => rsi >= 0.0 && rsi <= 100.0,
        },
        bbandLower: {
            type: Number,
        },
        bbandUpper: {
            type: Number,
        },
        bbandMiddle: {
            type: Number,
        },
        atr14: {
            type: Number,
            validate: (atr) => atr >= 0,
        },
        natr14: {
            type: Number,
            validate: (natr) => natr >= 0,
        },
    },
    {
        autoCreate: true,
        timestamps: true,
    },
);
technicalIndicator.index({ symbol: 1, date: -1 });
export const TechnicalIndicator = mongoose.model('TechnicalIndicator', technicalIndicator);

/** entry for stock in depot
 * @typedef VIX
 * @type {object}
 * @property {string} date date of VIX
 * @property {number} open open price
 * @property {number} high high price
 * @property {number} low low price
 * @property {number} close close price
 * @property {number} sma10 simple moving average over 10 days
 * @property {number} sma15 simple moving average over 15 days
 * @property {number} sma20 simple moving average over 20 days
 * @property {number} sma50 simple moving average over 50 days
 * @property {number} sma100 simple moving average over 100 days
 * @property {number} sma200 simple moving average over 200 days
 */
const vix = new mongoose.Schema(
    {
        date: {
            type: String,
            validate: (date) => date.length > 0,
            required: true,
        },
        open: {
            type: Number,
            validate: (open) => open >= 0,
            required: true,
        },
        high: {
            type: Number,
            validate: (high) => high >= 0,
            required: true,
        },
        low: {
            type: Number,
            validate: (low) => low >= 0,
            required: true,
        },
        close: {
            type: Number,
            validate: (close) => close >= 0,
            required: true,
        },
        sma10: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma15: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma20: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma50: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma100: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
        sma200: {
            type: Number,
            validate: (sma) => sma >= 0,
        },
    },
    {
        autoCreate: true,
        timestamps: true,
    },
);
vix.index({ date: -1 });
export const VIX = mongoose.model('VIX', vix);
