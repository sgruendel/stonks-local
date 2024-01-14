import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import querystring from 'querystring';

const httpAgent = new http.Agent({
    keepAlive: true,
});
const httpsAgent = new https.Agent({
    keepAlive: true,
});
const options = {
    agent: (_parsedURL) => {
        return _parsedURL.protocol === 'http:' ? httpAgent : httpsAgent;
    },
};

const BASE_URL = 'https://keyinvest-de.ubs.com/api/v2/';
// https://keyinvest-de.ubs.com/api/v2/page-api/trend-radar-signal/list?timeHorizon[]=2&timeHorizon[]=3&underlyings[]=3981269
// https://keyinvest-de.ubs.com/

export async function list(params) {
    const qs = {
        'timeHorizon[]': [2, 3],
        'underlyings[]': 3981269,
    };
    console.log(querystring.stringify(qs));
    const response = await fetch(BASE_URL + 'page-api/trend-radar-signal/list?' + querystring.stringify(qs), options);
    return response.json();
}
