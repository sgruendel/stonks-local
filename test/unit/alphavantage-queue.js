import assert from 'node:assert/strict';
import https from 'node:https';
import { mock } from 'node:test';
import { afterEach, describe, it } from 'mocha';

import { queryCompanyOverview } from '../../src/alphavantage.js';

describe('alphavantage queue', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('logs the queue error and rejects the request when fetching fails', async () => {
        const error = new Error('simulated network failure');
        mock.method(https, 'request', () => {
            throw error;
        });
        const log = mock.method(console, 'error', () => {});

        await assert.rejects(queryCompanyOverview('AMZN'), (reason) => reason === error);

        assert.equal(log.mock.callCount(), 1);
        assert.deepEqual(log.mock.calls[0].arguments, ['queue error' + error]);
    });
});
