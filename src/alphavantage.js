import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import PQueue from 'p-queue';
import querystring from 'querystring';
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

const httpAgent = new http.Agent({
    keepAlive: true,
});
const httpsAgent = new https.Agent({
    keepAlive: true,
});
/** @type {{ agent: (parsedURL: URL) => http.Agent | https.Agent }} */
const options = {
    agent: (_parsedURL) => {
        return _parsedURL.protocol === 'http:' ? httpAgent : httpsAgent;
    },
};

const API_KEY = process.env.ALPHAVANTAGE_API_KEY;
const INTERVAL_SECS = Number(process.env.ALPHAVANTAGE_INTERVAL_SECS) || 1;
const INTERVAL_CAP = Number(process.env.ALPHAVANTAGE_INTERVAL_CAP) || 1;

// Request limit of 75 per minute for Alpha Vantage with premium key, but no more than 5 per second;
// so we default to 1 per second to be safe (i.e. 60 per minute) and concurrency of 5
const queue = new PQueue({ concurrency: 5, interval: INTERVAL_SECS * 1000, intervalCap: INTERVAL_CAP });
queue.on('error', (err) => {
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
const TA_ATR = 'Technical Analysis: ATR';
const TA_NATR = 'Technical Analysis: NATR';

/** @typedef {Object.<string, string | number>} AlphaVantageQueryParams */

/** @typedef {Object.<string, unknown>} CompanyOverview */

/** @typedef {Object.<string, string | Object.<string, Object.<string, string>> | undefined>} AlphaVantageApiResponse */

/**
 * @typedef {object} DailyAdjustedRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} open Opening price.
 * @property {number} high Daily high price.
 * @property {number} low Daily low price.
 * @property {number} close Closing price.
 * @property {number} adjustedClose Split and dividend adjusted close price.
 * @property {number} volume Traded volume.
 * @property {number} dividendAmount Dividend amount for the day.
 * @property {number} splitCoefficient Split coefficient for the day.
 */

/**
 * @typedef {object} SMARecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} sma Simple moving average value.
 */

/**
 * @typedef {object} EMARecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} ema Exponential moving average value.
 */

/**
 * @typedef {object} MACDRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} macd MACD line value.
 * @property {number} hist MACD histogram value.
 * @property {number} signal MACD signal line value.
 */

/**
 * @typedef {object} RSIRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} rsi Relative strength index value.
 */

/**
 * @typedef {object} BBandsRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} lower Lower Bollinger band.
 * @property {number} upper Upper Bollinger band.
 * @property {number} middle Middle Bollinger band.
 */

/**
 * @typedef {object} ATRRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} atr Average true range value.
 */

/**
 * @typedef {object} NATRRecord
 * @property {string} symbol Stock ticker symbol.
 * @property {string} date Trading day in YYYY-MM-DD format.
 * @property {number} natr Normalized average true range value.
 */

/**
 * Returns the configured API key or a random fallback key for anonymous requests.
 *
 * @returns {string} Alpha Vantage API key.
 */
function getApiKey() {
    if (API_KEY) return API_KEY;

    // use random free key
    const min = 1;
    const max = 9999999;
    const apiKey = Math.floor(Math.random() * (max - min)) + min;
    return apiKey.toString();
}

/**
 * Normalizes Alpha Vantage field names to lower camel case where applicable.
 *
 * @param {string} key Response field name.
 * @returns {string} Normalized field name.
 */
function normalizeKey(key) {
    return /^[A-Z][a-z]/.test(key) ? key[0].toLowerCase() + key.substring(1) : key;
}

/**
 * Detects whether a parsed JSON payload has any usable content.
 *
 * @param {unknown} value Parsed JSON value.
 * @returns {boolean} True when the payload is nullish or structurally empty.
 */
function isEmptyJson(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

// see https://github.com/dynamoose/dynamoose/issues/209#issuecomment-374258965
/**
 * Retries Alpha Vantage requests when the API responds with throughput notes.
 *
 * @template TResult
 * @param {(params: AlphaVantageQueryParams) => Promise<TResult>} callback Request function to execute.
 * @param {AlphaVantageQueryParams} params Query string parameters.
 * @param {number} [attempt=1] Current retry attempt.
 * @returns {Promise<TResult>} Callback result after any required backoff.
 */
async function handleThroughput(callback, params, attempt = 1) {
    const BACK_OFF = 2000; // back off base time in millis
    const CAP = 60000; // max. back off time in millis

    const result = await callback(params);
    const apiResponse = /** @type {AlphaVantageApiResponse} */ (result);
    const note = apiResponse[NOTE];
    if (
        typeof note === 'string' &&
        note.startsWith('Thank you for using Alpha Vantage! Our standard API call frequency is ')
    ) {
        // exponential backoff with jitter,
        // see https://aws.amazon.com/de/blogs/architecture/exponential-backoff-and-jitter/
        const temp = Math.min(CAP, BACK_OFF * Math.pow(2, attempt));
        const sleep = temp / 2 + Math.floor((Math.random() * temp) / 2);
        logger.debug('Alphavantage: sleeping for ' + sleep + ' on attempt ' + attempt + ', temp ' + temp);
        await new Promise((resolve) => setTimeout(resolve, sleep));
        return handleThroughput(callback, params, attempt + 1);
    }
    return result;
}

/**
 * Executes a queued Alpha Vantage HTTP request and retries empty JSON payloads.
 *
 * @param {AlphaVantageQueryParams} qs Alpha Vantage query parameters.
 * @returns {Promise<unknown>} Parsed JSON response or the non-ok fetch response.
 */
async function query(qs) {
    logger.debug('calling ' + querystring.stringify(qs));
    let attempt = 0;
    while (true) {
        const response = await queue.add(() => fetch(BASE_URL + 'query?' + querystring.stringify(qs), options));
        logger.debug('queue size/pending: ' + queue.size + '/' + queue.pending);
        if (!response.ok) {
            return response; // contains error info
        }
        const json = await response.json();
        if (!isEmptyJson(json) || attempt++ > 10) {
            return json;
        }
        // empty response, retry
        logger.warn('empty response, retrying in attempt ' + attempt);
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_SECS * 1000));
    }
}

/**
 * Fetches a technical indicator series and converts the date-keyed payload into an array.
 *
 * @param {AlphaVantageQueryParams} qs Alpha Vantage query parameters.
 * @param {string} resultKey Response key that contains the indicator series.
 * @returns {Promise<Array<Object.<string, string> & { date: string }>>} Indicator values with their trading date.
 */
async function queryTechnicalIndicators(qs, resultKey) {
    const result = /** @type {AlphaVantageApiResponse} */ (await handleThroughput(query, qs));
    const errorMessage = result[ERROR_MESSAGE];
    if (typeof errorMessage === 'string') {
        logger.error('error message for ' + resultKey + ':', result);
        throw new Error(errorMessage);
    }

    const note = result[NOTE];
    if (typeof note === 'string') {
        logger.error('note for ' + resultKey + ':', result);
        throw new Error(note);
    }

    const resultObjArr = result[resultKey];
    if (typeof resultObjArr !== 'object' || resultObjArr === null || Array.isArray(resultObjArr)) {
        logger.error(JSON.stringify(result));
        throw new Error('Invalid response for ' + JSON.stringify(qs));
    }

    /** @type {Array<Object.<string, string> & { date: string }>} */
    const resultArr = [];
    for (const [date, resultObj] of Object.entries(resultObjArr)) {
        resultArr.push({ ...resultObj, date });
    }
    return resultArr;
}

/**
 * Retrieves normalized company overview metadata for a symbol.
 *
 * @param {string} symbol Stock ticker symbol.
 * @returns {Promise<CompanyOverview>} Normalized overview fields keyed by lower camel case names.
 */
export async function queryCompanyOverview(symbol) {
    const qs = {
        function: 'OVERVIEW',
        symbol: symbol,
        apikey: getApiKey(),
    };
    const result = /** @type {CompanyOverview} */ (await handleThroughput(query, qs));
    /** @type {CompanyOverview} */
    const overview = {};
    Object.keys(result).forEach((key) => {
        overview[normalizeKey(key)] = result[key];
    });
    return overview;
}

/**
 * Retrieves daily adjusted OHLCV data for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<DailyAdjustedRecord[]>} Daily adjusted price records.
 */
export async function queryDailyAdjusted(symbol, since) {
    const qs = {
        function: 'TIME_SERIES_DAILY_ADJUSTED',
        symbol: symbol,
        outputsize: FULL,
        apikey: getApiKey(),
    };
    const values = await queryTechnicalIndicators(qs, TS_DAILY);
    return values
        .filter((value) => value.date >= since)
        .map((value) => {
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
}

/**
 * Retrieves simple moving average values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod Moving average period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<SMARecord[]>} Simple moving average records.
 */
export async function querySMA(symbol, timePeriod, since) {
    const qs = {
        function: 'SMA',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const smas = await queryTechnicalIndicators(qs, TA_SMA);
    return smas
        .filter((sma) => sma.date >= since)
        .map((sma) => {
            return { symbol: symbol, date: sma.date, sma: Number(sma.SMA) };
        });
}

/**
 * Retrieves exponential moving average values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod Moving average period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<EMARecord[]>} Exponential moving average records.
 */
export async function queryEMA(symbol, timePeriod, since) {
    const qs = {
        function: 'EMA',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const emas = await queryTechnicalIndicators(qs, TA_EMA);
    return emas
        .filter((ema) => ema.date >= since)
        .map((ema) => {
            return { symbol: symbol, date: ema.date, ema: Number(ema.EMA) };
        });
}

/**
 * Retrieves MACD values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<MACDRecord[]>} MACD records including histogram and signal values.
 */
export async function queryMACD(symbol, since) {
    const qs = {
        function: 'MACD',
        symbol: symbol,
        interval: INTERVAL,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const macds = await queryTechnicalIndicators(qs, TA_MACD);
    return macds
        .filter((macd) => macd.date >= since)
        .map((macd) => {
            return {
                symbol: symbol,
                date: macd.date,
                macd: Number(macd.MACD),
                hist: Number(macd.MACD_Hist),
                signal: Number(macd.MACD_Signal),
            };
        });
}

/**
 * Retrieves RSI values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod RSI period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<RSIRecord[]>} Relative strength index records.
 */
export async function queryRSI(symbol, timePeriod, since) {
    const qs = {
        function: 'RSI',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const rsis = await queryTechnicalIndicators(qs, TA_RSI);
    return rsis
        .filter((rsi) => rsi.date >= since)
        .map((rsi) => {
            return {
                symbol: symbol,
                date: rsi.date,
                rsi: Number(rsi.RSI),
            };
        });
}

/**
 * Retrieves Bollinger Bands values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod Bollinger band period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<BBandsRecord[]>} Bollinger band records.
 */
export async function queryBBands(symbol, timePeriod, since) {
    const qs = {
        function: 'BBANDS',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        series_type: SERIES_TYPE,
        apikey: getApiKey(),
    };
    const bbandsArr = await queryTechnicalIndicators(qs, TA_BBANDS);
    return bbandsArr
        .filter((bbands) => bbands.date >= since)
        .map((bbands) => {
            return {
                symbol: symbol,
                date: bbands.date,
                lower: Number(bbands['Real Lower Band']),
                upper: Number(bbands['Real Upper Band']),
                middle: Number(bbands['Real Middle Band']),
            };
        });
}

/**
 * Retrieves average true range values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod ATR period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<ATRRecord[]>} Average true range records.
 */
export async function queryATR(symbol, timePeriod, since) {
    const qs = {
        function: 'ATR',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        apikey: getApiKey(),
    };
    const atrs = await queryTechnicalIndicators(qs, TA_ATR);
    return atrs
        .filter((atr) => atr.date >= since)
        .map((atr) => {
            return {
                symbol: symbol,
                date: atr.date,
                atr: Number(atr.ATR),
            };
        });
}

/**
 * Retrieves normalized average true range values for a symbol from the given date onward.
 *
 * @param {string} symbol Stock ticker symbol.
 * @param {number} timePeriod NATR period.
 * @param {string} since Inclusive lower date bound in YYYY-MM-DD format.
 * @returns {Promise<NATRRecord[]>} Normalized average true range records.
 */
export async function queryNATR(symbol, timePeriod, since) {
    const qs = {
        function: 'NATR',
        symbol: symbol,
        interval: INTERVAL,
        time_period: timePeriod,
        apikey: getApiKey(),
    };
    const natrs = await queryTechnicalIndicators(qs, TA_NATR);
    return natrs
        .filter((natr) => natr.date >= since)
        .map((natr) => {
            return {
                symbol: symbol,
                date: natr.date,
                natr: Number(natr.NATR),
            };
        });
}
