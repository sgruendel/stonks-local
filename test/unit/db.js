import { expect } from 'chai';
import { describe, it, after } from 'mocha';

import * as db from '../../src/db.js';

describe('db', () => {
    after(() => {
        db.disconnect();
    });

    describe('#handleThroughput()', () => {
        it('should work for normal case', () => {
            return db.handleThroughput((params) => {
                expect(params).to.equal('123');
            }, '123');
        });

        it('should work for ProvisionedThroughputExceededException', () => {
            class DynamoDBError extends Error {
                constructor(code, ...params) {
                    super(...params);
                    this.code = code;
                }
            }

            let thrown = false;
            return db.handleThroughput((params) => {
                if (!thrown) {
                    thrown = true;
                    throw new DynamoDBError('ProvisionedThroughputExceededException');
                }
                expect(params).to.equal('123');
            }, '123');
        });

        it('should work for other Exception', (done) => {
            db.handleThroughput((params) => {
                throw new Error('expected exception');
            }, '123')
                .then(() => {
                    throw new Error("shouldn't be here");
                })
                .catch((err) => {
                    if (err.message !== 'expected exception') {
                        // Evil hack: calling done() twice to make it fail, as re-throwing err here just results in a timeout :(
                        console.error(err);
                        done();
                    }
                    done();
                });
        });
    });

    describe('#CompanyOverview.symbol.validate()', () => {
        it('should work for AMZN', () => {
            const schemaObj = db.CompanyOverview.schema.obj;
            expect(schemaObj.symbol.validate('AMZN')).to.be.true;
        });
    });

    describe('#DailyAdjusted.symbol.validate()', () => {
        it('should work for AMZN', () => {
            const schemaObj = db.DailyAdjusted.schema.obj;
            expect(schemaObj.symbol.validate('AMZN')).to.be.true;
        });
    });

    describe('#DailyAdjusted.date.validate()', () => {
        it('should work for 2021-01-04', () => {
            const schemaObj = db.DailyAdjusted.schema.obj;
            expect(schemaObj.date.validate('2021-01-04')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.symbol.validate()', () => {
        it('should work for AMZN', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.symbol.validate('AMZN')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.date.validate()', () => {
        it('should work for 2021-01-04', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.date.validate('2021-01-04')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.rsi14.validate()', () => {
        it('should fail for -0.1', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(-0.1)).to.be.false;
        });

        it('should work for 0.0', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(0.0)).to.be.true;
        });

        it('should work for 30.0', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(30.0)).to.be.true;
        });

        it('should work for 70.0', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(70.0)).to.be.true;
        });

        it('should work for 100.0', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(100.0)).to.be.true;
        });

        it('should fail for 100.1', () => {
            const schemaObj = db.TechnicalIndicator.schema.obj;
            expect(schemaObj.rsi14.validate(100.1)).to.be.false;
        });
    });
});
