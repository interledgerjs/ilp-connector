/*global describe, it*/
/*eslint-disable no-multi-str*/
/*eslint max-nested-callbacks: [4]*/
'use strict';
const nock = require('nock');
const app = require('../app');
const ratesResponse = require('./data/fxRates.json');
const validate = require('five-bells-shared/services/validate');
const appHelper = require('./helpers/app');
const logHelper = require('five-bells-shared/testHelpers/log');


describe('Quotes', function() {

  beforeEach(function() {
    logHelper();

    appHelper.create(this, app);

    nock('http://api.fixer.io/latest')
    .get('')
    .reply(200, ratesResponse);
  });

  describe('GET /quote', function() {

    // it('should return a 400 if the \
    //  source owner is not specified', function(done) {
    // });
    // it('should return a 400 if the
    //  source owner is not specified', function(done) {
    // });
    // it('should return a 400 if the source owner is invalid', function(done) {
    // });
    // it('should return a 400 if the \
    //  source owner is not specified', function(done) {
    // });

    it('should return a valid Settlement Template object', function(done) {
      this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_asset=EUR' +
          '&source_ledger=ledger.eu' +
          '&destination_asset=USD' +
          '&destination_ledger=ledger.us')
        .expect(function(res) {
          let validation = validate('SettlementTemplate', res.body);
          if (!validation.valid) {
            console.log('Invalid Settlement: ', validation.errors);
            throw new Error('Not a valid settlement');
          }
        })
        .end(done);
    });

    it('should return quotes for fixed source amounts', function(done) {
      this.request()
        .get('/quote?source_amount=100' +
          '&source_asset=EUR' +
          '&source_ledger=ledger.eu' +
        '&destination_asset=USD' +
        '&destination_ledger=ledger.us')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'EUR',
              ledger: 'ledger.eu',
              account: 'mark',
              amount: '100.00'
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'mark'
            }]
          }
        }, done);
    });

    it('should return quotes for fixed destination amounts', function(done) {
      this.request()
        .get('/quote?source_asset=EUR' +
          '&source_ledger=ledger.eu' +
          '&destination_amount=100' +
        '&destination_asset=USD' +
        '&destination_ledger=ledger.us')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'EUR',
              ledger: 'ledger.eu',
              account: 'mark',
              amount: '94.60' // 1/ (EUR/USD Rate of 1.0592 + .2% spread)
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              amount: '100.00',
              account: 'mark'
            }]
          }
        }, done);
    });

    it('should return a settlement object with the source' +
      'and destination amounts filled in as debits and credits',
      function(done) {
      this.request()
        .get('/quote?source_amount=100' +
          '&source_asset=EUR' +
          '&source_ledger=ledger.eu' +
        '&destination_asset=USD' +
        '&destination_ledger=ledger.us')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'EUR',
              ledger: 'ledger.eu',
              account: 'mark',
              amount: '100.00'
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'mark'
            }]
          }
        }, done);
    });

    it('should apply the spread correctly for settlements where the source' +
      'asset is the counter currency in the fx rates', function(done) {
      this.request()
        .get('/quote?source_amount=100' +
          '&source_asset=USD' +
          '&source_ledger=ledger.us' +
        '&destination_asset=EUR' +
        '&destination_ledger=ledger.eu')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              account: 'mark',
              amount: '100.00'
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'EUR',
              ledger: 'ledger.eu',
              amount: '94.22', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
              account: 'mark'
            }]
          }
        }, done);
    });

    it('should determine the correct rate and spread when neither the source ' +
      'nor destination asset is the base currency in the rates',
      function(done) {
      this.request()
        .get('/quote?source_amount=100' +
          '&source_asset=USD' +
          '&source_ledger=ledger.us' +
        '&destination_asset=CAD' +
        '&destination_ledger=ledger.ca')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              account: 'mark',
              amount: '100.00'
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'CAD',
              ledger: 'ledger.ca',
              amount: '127.98', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
              account: 'mark'
            }]
          }
        }, done);
    });

    it('should determine the correct rate and spread when neither the source ' +
      'nor destination asset is the base currency in the rates and the rate' +
    'must be flipped', function(done) {
      this.request()
        .get('/quote?source_amount=100' +
          '&source_asset=CAD' +
          '&source_ledger=ledger.ca' +
        '&destination_asset=USD' +
        '&destination_ledger=ledger.us')
        .expect(200, {
          source_transfer: {
            credits: [{
              asset: 'CAD',
              ledger: 'ledger.ca',
              amount: '100.00',
              account: 'mark'
            }]
          },
          destination_transfer: {
            debits: [{
              asset: 'USD',
              ledger: 'ledger.us',
              account: 'mark',
              amount: '77.82' // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
            }]
          }
        }, done);
    });
  });

});
