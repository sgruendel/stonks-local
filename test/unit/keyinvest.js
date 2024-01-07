'use strict';

const expect = require('chai').expect;

const keyinvest = require('../../src/keyinvest');

describe('keyinvest', () => {
    describe('#list()', () => {
        it('should work for AMZN', async() => {
            const result = await keyinvest.list('AMZN');
            console.log(result);
            expect(result.status).to.equal('OK');
        });
    });
});
