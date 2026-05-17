import { expect } from 'chai';
import { describe, it, after } from 'mocha';

import * as db from '../../src/db.js';

/**
 * @typedef {object} SchemaFieldWithValidate
 * @property {(value: string | number) => boolean} validate Schema validator function.
 */

/**
 * Returns a schema field with a callable `validate` function.
 *
 * @param {Record<string, unknown>} schemaObj Raw schema object.
 * @param {string} fieldName Field name to access.
 * @returns {SchemaFieldWithValidate} Typed schema field.
 */
function getSchemaField(schemaObj, fieldName) {
    return /** @type {SchemaFieldWithValidate} */ (schemaObj[fieldName]);
}

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
                /**
                 * @param {string} code Error code.
                 * @param {...string} params Error message parameters.
                 */
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
            const schemaObj = /** @type {Record<string, unknown>} */ (db.CompanyOverview.schema.obj);
            expect(getSchemaField(schemaObj, 'symbol').validate('AMZN')).to.be.true;
        });
    });

    describe('#DailyAdjusted.symbol.validate()', () => {
        it('should work for AMZN', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.DailyAdjusted.schema.obj);
            expect(getSchemaField(schemaObj, 'symbol').validate('AMZN')).to.be.true;
        });
    });

    describe('#DailyAdjusted.date.validate()', () => {
        it('should work for 2021-01-04', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.DailyAdjusted.schema.obj);
            expect(getSchemaField(schemaObj, 'date').validate('2021-01-04')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.symbol.validate()', () => {
        it('should work for AMZN', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'symbol').validate('AMZN')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.date.validate()', () => {
        it('should work for 2021-01-04', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'date').validate('2021-01-04')).to.be.true;
        });
    });

    describe('#TechnicalIndicator.rsi14.validate()', () => {
        it('should fail for -0.1', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(-0.1)).to.be.false;
        });

        it('should work for 0.0', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(0.0)).to.be.true;
        });

        it('should work for 30.0', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(30.0)).to.be.true;
        });

        it('should work for 70.0', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(70.0)).to.be.true;
        });

        it('should work for 100.0', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(100.0)).to.be.true;
        });

        it('should fail for 100.1', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14').validate(100.1)).to.be.false;
        });
    });

    describe('#TechnicalIndicator.rsi14Sma14.validate()', () => {
        it('should work for 55.5', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'rsi14Sma14').validate(55.5)).to.be.true;
        });
    });

    describe('#TechnicalIndicator.sma250.validate()', () => {
        it('should work for 123.45', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'sma250').validate(123.45)).to.be.true;
        });
    });

    describe('#TechnicalIndicator.ema250.validate()', () => {
        it('should work for 123.45', () => {
            const schemaObj = /** @type {Record<string, unknown>} */ (db.TechnicalIndicator.schema.obj);
            expect(getSchemaField(schemaObj, 'ema250').validate(123.45)).to.be.true;
        });
    });
});
