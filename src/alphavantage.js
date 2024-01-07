'use strict';

const fetch = require('node-fetch');
const http = require('http');
const https = require('https');
const { default: PQueue } = require('p-queue');
const querystring = require('querystring');
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

const httpAgent = new http.Agent({
    keepAlive: true,
});
const httpsAgent = new https.Agent({
    keepAlive: true,
});
const options = {
    agent: _parsedURL => {
        return (_parsedURL.protocol === 'http:') ? httpAgent : httpsAgent;
    },
};

const API_KEY = process.env.ALPHAVANTAGE_API_KEY;
const INTERVAL_CAP = Number(process.env.ALPHAVANTAGE_INTERVAL_CAP) || 5;

// Request limit of 5 per minute for Alpha Vantage with free key; max. 500 per day not considered here
const queue = new PQueue({ concurrency: 5, interval: 60 * 1000, intervalCap: INTERVAL_CAP });
queue.on('error', err => {
    console.error('queue error' + err);
});

const BASE_URL = 'https://www.alphavantage.co/';
const FULL = 'full';
const INTERVAL = 'daily';
const SERIES_TYPE = 'close';

const ERROR_MESSAGE = 'Error Message';
const NOTE = 'Note';
const TS_DAILY = 'Time Series (Daily)';
const TA_SMA = 'Technical Analysis: SMA';
const TA_EMA = 'Technical Analysis: EMA';
const TA_MACD = 'Technical Analysis: MACD';
const TA_BBANDS = 'Technical Analysis: BBANDS';
const TA_RSI = 'Technical Analysis: RSI';

var exports = module.exports = {};

function getApiKey() {
    if (API_KEY) return API_KEY;

    // use random free key
    const min = 1;
    const max = 9999999;
    const apiKey = Math.floor(Math.random() * (max - min)) + min;
    return apiKey;
}

function normalizeKey(key) {
    return (/^[A-Z][a-z]/.test(key)) ? (key[0].toLowerCase() + key.substr(1)) : key;
}

// see https://github.com/dynamoose/dynamoose/issues/209#issuecomment-374258965
async function handleThroughput(callback, params, attempt = 1) {
    const BACK_OFF = 2000; // back off base time in millis
    const CAP = 60000; // max. back off time in millis

    const result = await callback(params);
    if (result[NOTE] && result[NOTE].startsWith('Thank you for using Alpha Vantage! Our standard API call frequency is ')) {
        // exponential backoff with jitter,
        // see https://aws.amazon.com/de/blogs/architecture/exponential-backoff-and-jitter/
        const temp = Math.min(CAP, BACK_OFF * Math.pow(2, attempt));
        const sleep = temp / 2 + Math.floor(Math.random() * temp / 2);
        logger.debug('Alphavantage: sleeping for ' + sleep + ' on attempt ' + attempt + ', temp ' + temp);
        await new Promise(resolve => setTimeout(resolve, sleep));
        return handleThroughput(callback, params, ++attempt);
    }
    return result;
}

async function query(qs) {
    logger.debug('calling ' + querystring.stringify(qs));
    const response = await queue.add(() => fetch(BASE_URL + 'query?' + querystring.stringify(qs), options));
    logger.debug('queue size/pending: ' + queue.size + '/' + queue.pending);
    return response.json();
}

async function queryTechnicalIndicators(qs, resultKey) {
    const result = await handleThroughput(query, qs);
    if (result[ERROR_MESSAGE]) {
        logger.error('error message for ' + resultKey + ':', result);
        throw new Error(result[ERROR_MESSAGE]);
    } else if (result[NOTE]) {
        logger.error('note for ' + resultKey + ':', result);
        throw new Error(result[NOTE]);
    } else if (!result[resultKey]) {
        logger.error(JSON.stringify(result));
        throw new Error('Invalid reponse for ' + JSON.stringify(qs));
    }

    const resultObjArr = result[resultKey];
    const resultArr = [];
    for (const date in resultObjArr) {
        const resultObj = resultObjArr[date];
        resultObj.date = date;
        resultArr.push(resultObj);
    }
    return resultArr;
}

exports.queryCompanyOverview = async(symbol) => {
    const qs = {
        function: 'OVERVIEW',
        symbol: symbol,
        apikey: getApiKey(),
    };
    const result = await handleThroughput(query, qs);
    const overview = {};
    Object.keys(result).forEach(key => {
        overview[normalizeKey(key)] = result[key];
    });
    return overview;
};

exports.queryDailyAdjusted = async(symbol, since) => {
    const qs = {
        function: 'TIME_SERIES_DAILY_ADJUSTED',
        symbol: symbol,
        outputsize: FULL,
        apikey: getApiKey(),
    };
    const values = await queryTechnicalIndicators(qs, TS_DAILY);
    return values.filter(value => value.date >= since).map(value => {
        return {
            symbol: symbol,
            date: value.date,
            open: Number(value['1. open']),
            high: Number(value['2. high']),
            low: Number(value['3. low']),
            close: Number(value['4. close']),
            adjustedClose: Number(value['5. adjusted close']),
            volume: Number(value['6. volume']),
            dividendAmount: Number(value['7. dividend amount']),
            splitCoefficient: Number(value['8. split coefficient']),
        };
    });
};

exports.querySMA = async(symbol, timePeriod, since) => {
    const qs = {
        function: 'SMA',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const smas = await queryTechnicalIndicators(qs, TA_SMA);
    return smas.filter(sma => sma.date >= since).map(sma => {
        return { symbol: symbol, date: sma.date, sma: Number(sma.SMA) };
    });
};

exports.queryEMA = async(symbol, timePeriod, since) => {
    const qs = {
        function: 'EMA',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const emas = await queryTechnicalIndicators(qs, TA_EMA);
    return emas.filter(ema => ema.date >= since).map(ema => {
        return { symbol: symbol, date: ema.date, ema: Number(ema.EMA) };
    });
};

exports.queryMACD = async(symbol, since) => {
    const qs = {
        function: 'MACD',
        symbol: symbol,
        interval: INTERVAL,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const macds = await queryTechnicalIndicators(qs, TA_MACD);
    return macds.filter(macd => macd.date >= since).map(macd => {
        return {
            symbol: symbol,
            date: macd.date,
            macd: Number(macd.MACD),
            hist: Number(macd.MACD_Hist),
            signal: Number(macd.MACD_Signal),
        };
    });
};

exports.queryRSI = async(symbol, timePeriod, since) => {
    const qs = {
        function: 'RSI',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const rsis = await queryTechnicalIndicators(qs, TA_RSI);
    return rsis.filter(rsi => rsi.date >= since).map(rsi => {
        return {
            symbol: symbol,
            date: rsi.date,
            rsi: Number(rsi.RSI),
        };
    });
};

exports.queryBBands = async(symbol, timePeriod, since) => {
    const qs = {
        function: 'BBANDS',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const bbandsArr = await queryTechnicalIndicators(qs, TA_BBANDS);
    return bbandsArr.filter(bbands => bbands.date >= since).map(bbands => {
        return {
            symbol: symbol,
            date: bbands.date,
            lower: Number(bbands['Real Lower Band']),
            upper: Number(bbands['Real Upper Band']),
            middle: Number(bbands['Real Middle Band']),
        };
    });
};
