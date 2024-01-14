import * as mongoose from 'mongoose';
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

export const CompanyOverview = mongoose.model(
    'CompanyOverview',
    new mongoose.Schema(
        {
            symbol: {
                type: String,
                validate: (symbol) => symbol.length > 0,
                required: true,
            },
        },
        {
            autoCreate: true,
            strict: false,
            timestamps: true,
        },
    ),
);

const dailyAdjusteds = new mongoose.Schema(
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
dailyAdjusteds.index({ symbol: 1, date: -1 });
export const DailyAdjusted = mongoose.model('DailyAdjusted', dailyAdjusteds);

const technicalIndicators = new mongoose.Schema(
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
        rsi: {
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
    },
    {
        autoCreate: true,
        timestamps: true,
    },
);
technicalIndicators.index({ symbol: 1, date: -1 });
export const TechnicalIndicators = mongoose.model('TechnicalIndicators', technicalIndicators);

const vixs = new mongoose.Schema(
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
vixs.index({ date: -1 });
export const VIXs = mongoose.model('VIXs', vixs);
