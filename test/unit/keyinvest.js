import { expect } from 'chai';
import { describe, it } from 'mocha';

import * as keyinvest from '../../src/keyinvest.js';

describe('keyinvest', () => {
    describe('#list()', () => {
        it('should work for AMZN', async () => {
            const result = await keyinvest.list('AMZN');
            console.log(result);
            expect(result.status).to.equal('OK');
        });
    });
});
