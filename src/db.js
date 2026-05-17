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

/**
 * Checks whether a schema string value is non-empty.
 *
 * @param {string} value Value to validate.
 * @returns {boolean} True when the string is not empty.
 */
const isNonEmptyString = (value) => value.length > 0;

/**
 * Checks whether a numeric schema value is zero or greater.
 *
 * @param {number} value Value to validate.
 * @returns {boolean} True when the value is non-negative.
 */
const isNonNegative = (value) => value >= 0;

/**
 * Checks whether an RSI-like value stays within the inclusive 0-100 range.
 *
 * @param {number} value Value to validate.
 * @returns {boolean} True when the value is between 0 and 100.
 */
const isPercentage = (value) => value >= 0.0 && value <= 100.0;

// see https://github.com/dynamoose/dynamoose/issues/209#issuecomment-374258965
/**
 * Retries a database callback when throughput is exceeded.
 *
 * @template TParams
 * @template TResult
 * @param {(params: TParams) => Promise<TResult> | TResult} callback Operation to execute.
 * @param {TParams} params Operation parameters.
 * @param {number} [attempt=1] Current retry attempt.
 * @returns {Promise<TResult>} Callback result after any required backoff.
 */
export async function handleThroughput(callback, params, attempt = 1) {
    const BACK_OFF = 500; // back off base time in millis
    const CAP = 10000; // max. back off time in millis

    try {
        return await callback(params);
    } catch (e) {
        const error = /** @type {Error & { code?: string }} */ (e);
        if (error.code === 'ProvisionedThroughputExceededException') {
            // exponential backoff with jitter,
            // see https://aws.amazon.com/de/blogs/architecture/exponential-backoff-and-jitter/
            const temp = Math.min(CAP, BACK_OFF * Math.pow(2, attempt));
            const sleep = temp / 2 + Math.floor((Math.random() * temp) / 2);
            logger.debug('MongoDB: sleeping for ' + sleep + ' on attempt ' + attempt + ', temp ' + temp);
            await new Promise((resolve) => setTimeout(resolve, sleep));
            return handleThroughput(callback, params, attempt + 1);
        } else throw e;
    }
}

const companyOverview = new mongoose.Schema(
    {
        symbol: {
            type: String,
            validate: isNonEmptyString,
            required: true,
        },
        date: {
            type: String,
            validate: isNonEmptyString,
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
            validate: isNonEmptyString,
            required: true,
        },
        date: {
            type: String,
            validate: isNonEmptyString,
            required: true,
        },
        open: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        high: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        low: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        close: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        adjustedClose: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        volume: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        dividendAmount: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        splitCoefficient: {
            type: Number,
            validate: isNonNegative,
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
 * @property {number} sma250 simple moving average over 250 days
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
 * @property {number} ema250 exponential moving average over 250 days
 * @property {number} macd moving average convergence divergence
 * @property {number} macdHist moving average convergence divergence histogram
 * @property {number} macdSignal moving average convergence divergence signal
 * @property {number} rsi2 relative strength index over 2 days
 * @property {number} rsi14 relative strength index over 14 days
 * @property {number} rsi14Sma14 simple moving average over 14 days for RSI14
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
            validate: isNonEmptyString,
            required: true,
        },
        date: {
            type: String,
            validate: isNonEmptyString,
            required: true,
        },
        sma15: {
            type: Number,
            validate: isNonNegative,
        },
        sma20: {
            type: Number,
            validate: isNonNegative,
        },
        sma50: {
            type: Number,
            validate: isNonNegative,
        },
        sma100: {
            type: Number,
            validate: isNonNegative,
        },
        sma200: {
            type: Number,
            validate: isNonNegative,
        },
        sma250: {
            type: Number,
            validate: isNonNegative,
        },
        ema5: {
            type: Number,
            validate: isNonNegative,
        },
        ema8: {
            type: Number,
            validate: isNonNegative,
        },
        ema9: {
            type: Number,
            validate: isNonNegative,
        },
        ema12: {
            type: Number,
            validate: isNonNegative,
        },
        ema13: {
            type: Number,
            validate: isNonNegative,
        },
        ema20: {
            type: Number,
            validate: isNonNegative,
        },
        ema21: {
            type: Number,
            validate: isNonNegative,
        },
        ema26: {
            type: Number,
            validate: isNonNegative,
        },
        ema34: {
            type: Number,
            validate: isNonNegative,
        },
        ema50: {
            type: Number,
            validate: isNonNegative,
        },
        ema100: {
            type: Number,
            validate: isNonNegative,
        },
        ema200: {
            type: Number,
            validate: isNonNegative,
        },
        ema250: {
            type: Number,
            validate: isNonNegative,
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
            validate: isPercentage,
        },
        rsi14: {
            type: Number,
            validate: isPercentage,
        },
        rsi14Sma14: {
            type: Number,
            validate: isPercentage,
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
            validate: isNonNegative,
        },
        natr14: {
            type: Number,
            validate: isNonNegative,
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
            validate: isNonEmptyString,
            required: true,
        },
        open: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        high: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        low: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        close: {
            type: Number,
            validate: isNonNegative,
            required: true,
        },
        sma10: {
            type: Number,
            validate: isNonNegative,
        },
        sma15: {
            type: Number,
            validate: isNonNegative,
        },
        sma20: {
            type: Number,
            validate: isNonNegative,
        },
        sma50: {
            type: Number,
            validate: isNonNegative,
        },
        sma100: {
            type: Number,
            validate: isNonNegative,
        },
        sma200: {
            type: Number,
            validate: isNonNegative,
        },
    },
    {
        autoCreate: true,
        timestamps: true,
    },
);
vix.index({ date: -1 });
export const VIX = mongoose.model('VIX', vix);
