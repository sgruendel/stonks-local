'use strict';

const fetch = require('node-fetch');
const querystring = require('querystring');

const BASE_URL = 'https://keyinvest-de.ubs.com/api/v2/';
//https://keyinvest-de.ubs.com/api/v2/page-api/trend-radar-signal/list?timeHorizon[]=2&timeHorizon[]=3&underlyings[]=3981269
//https://keyinvest-de.ubs.com/

var exports = module.exports = {};

exports.list = async(params) => {
    const qs = {
        'timeHorizon[]': [ 2, 3 ],
        'underlyings[]': 3981269,
    };
    console.log(querystring.stringify(qs));
    const response = await fetch(BASE_URL + 'page-api/trend-radar-signal/list?' + querystring.stringify(qs));
    return response.json();
};
