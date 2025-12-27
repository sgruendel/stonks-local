import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as alphavantage from '../../src/alphavantage.js';

const expectThrowsAsync = async (method, errorMessage) => {
    let error = null;
    try {
        await method();
    } catch (err) {
        error = err;
    }
    expect(error).to.be.an('Error');
    if (errorMessage) {
        expect(error.message).to.equal(errorMessage);
    }
};

describe('alphavantage', () => {
    describe('#queryCompanyOverview()', () => {
        it('should work for AMZN', async () => {
            const result = await alphavantage.queryCompanyOverview('AMZN');
            expect(result.symbol).to.equal('AMZN');
            expect(result.name).to.equal('Amazon.com Inc');
        });
    });

    describe('#queryDailyAdjusted()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryDailyAdjusted('AMZN', '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.open).to.equal(3275);
            expect(result.high).to.equal(3282.9219);
            expect(result.low).to.equal(3241.2);
            expect(result.close).to.equal(3256.93);
            expect(result.adjustedClose).to.equal(162.8465);
            expect(result.volume).to.equal(2957206);
            expect(result.dividendAmount).to.equal(0);
            expect(result.splitCoefficient).to.equal(1);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryDailyAdjusted('AMZN', '9999-12-31');
            expect(results.length).equal(0);
        });
    });

    describe('#querySMA()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.querySMA('AMZN', 38, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.sma).to.equal(158.6455);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.querySMA('AMZN', 38, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.querySMA('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for SMA.',
            );
        });
    });

    describe('#queryEMA()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryEMA('AMZN', 50, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.ema).to.equal(159.33);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryEMA('AMZN', 50, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.queryEMA('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for EMA.',
            );
        });
    });

    describe('#queryMACD()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryMACD('AMZN', '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.macd).to.equal(1.4307);
            expect(result.hist).to.equal(0.5392);
            expect(result.signal).to.equal(0.8915);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryMACD('AMZN', '9999-12-31');
            expect(results.length).equal(0);
        });
    });

    describe('#queryRSI()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryRSI('AMZN', 14, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.rsi).to.equal(56.0688);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryRSI('AMZN', 14, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.queryRSI('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for RSI.',
            );
        });
    });

    describe('#queryBBands()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryBBands('AMZN', 20, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.lower).to.equal(153.9395);
            expect(result.upper).to.equal(165.6949);
            expect(result.middle).to.equal(159.8172);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryBBands('AMZN', 20, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.queryBBands('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for BBANDS.',
            );
        });
    });

    describe('#queryATR()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryATR('AMZN', 14, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.atr).to.equal(3.2913);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryATR('AMZN', 14, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.queryATR('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for ATR.',
            );
        });
    });

    describe('#queryNATR()', () => {
        it('should work for AMZN since 2020-12-31', async () => {
            const results = await alphavantage.queryNATR('AMZN', 14, '2020-12-31');
            expect(results.length).greaterThan(1);
            const result = results.slice(-1)[0];
            expect(result.symbol).to.equal('AMZN');
            expect(result.date).to.equal('2020-12-31');
            expect(result.natr).to.equal(2.0211);
        });

        it('should work for AMZN since <future date>', async () => {
            const results = await alphavantage.queryNATR('AMZN', 14, '9999-12-31');
            expect(results.length).equal(0);
        });

        it('should fail for invalid time period', async () => {
            await expectThrowsAsync(
                () => alphavantage.queryNATR('AMZN', 'abc', '2021-01-04'),
                'Invalid API call. Please retry or visit the documentation (https://www.alphavantage.co/documentation/) for NATR.',
            );
        });
    });
});
