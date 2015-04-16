/*global describe, it*/
/*eslint-disable no-multi-str*/
/*eslint max-nested-callbacks: [4]*/
'use strict';
const _ = require('lodash');
const crypto = require('crypto');
const expect = require('chai').expect;
const nock = require('nock');
nock.enableNetConnect(['localhost']);
const app = require('../app');
const appHelper = require('./helpers/app');
const logHelper = require('five-bells-shared/testHelpers/log');
const ratesResponse = require('./data/fxRates.json');

describe('Settlements', function () {

  describe('PUT /settlements/:id', function () {

    beforeEach(function() {
      logHelper();
      appHelper.create(this, app);

      this.basicSettlement = _.cloneDeep(require('./data/settlement1.json'));

      nock('http://api.fixer.io/latest')
        .get('')
        .reply(200, ratesResponse);
    });

    it('should return a 400 if the id is not a valid uuid', function *() {
      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.id = 'not valid';

      yield this.request()
        .put('/settlements/' + settlement.id)
        .send(settlement)
        .expect(400)
        .expect(function(res) {
          expect(res.body.id).to.equal('InvalidUriParameterError');
          expect(res.body.message).to.equal('id is not a valid Uuid');
        })
        .end();
    });

    it('should return a 422 if the source and destination transfer ' +
      'conditions are set but do not match', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.execution_condition = {
        condition1: true
      };
      settlement.destination_transfer.execution_condition = {
        condition2: false
      };

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableConditionsError');
          expect(res.body.message).to.equal('Source and destination transfer ' +
            'execution conditions must match or the source transfer\'s ' +
            'condition must be the completion of the destination transfer');
        })
        .end();
    });

    it('should return a 422 if the settlement does not include the ' +
      'trader in the source transfer credits', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.credits[0].account = 'mary';

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('NoRelatedSourceCreditError');
          expect(res.body.message).to.equal('Trader\'s account must be ' +
            'credited in source transfer to provide settlement');
        })
        .end();
    });

    it('should return a 422 if the settlement does not include the ' +
      'trader in the destination transfer debits', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.destination_transfer.debits[0].account = 'mary';

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('NoRelatedDestinationDebitError');
          expect(res.body.message).to.equal('Trader\'s account must be ' +
            'debited in destination transfer to provide settlement');
        })
        .end();
    });

    it('should return a 422 if the rate of the settlement is worse than ' +
      'the one currently offered', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.credits[0].amount = '1.00';

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableRateError');
          expect(res.body.message).to.equal('Settlement rate does not match ' +
            'the rate currently offered');
        })
        .end();
    });

    it('should return a 422 if source transfer debits cancel out the credits ' +
      ' in an attempt to cheat the trader', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.debits.push(
        settlement.source_transfer.credits[0]);
      settlement.source_transfer.credits.push(
        settlement.source_transfer.debits[0]);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableRateError');
          expect(res.body.message).to.equal('Settlement rate does not match ' +
            'the rate currently offered');
        })
        .end();
    });

    it('should return a 422 if the settlement includes assets this trader ' +
      'does not offer rates between', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.credits[0].asset = 'XYZ';
      settlement.source_transfer.debits[0].asset = 'XYZ';
      settlement.destination_transfer.credits[0].asset = 'XYZ';
      settlement.destination_transfer.debits[0].asset = 'XYZ';

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('AssetsNotTradedError');
          expect(res.body.message).to.equal('This trader does not support ' +
          'the given asset pair');
        })
        .end();
    });

    it('should accept upper case UUIDs but convert them to lower case',
      function *() {

      this.basicSettlement.id = this.basicSettlement.id.toUpperCase();
      const settlement = this.formatId(this.basicSettlement, '/settlements/');

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(function(res) {
          expect(res.body.id).to.equal(res.body.id.toLowerCase());
        })
        .end();
    });

    it('should return a 201 for a new settlement', function *() {
      const settlement = this.formatId(this.basicSettlement, '/settlements/');

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201)
        .end();
    });

    // it('should return an error for a UUID that has already been used',
    //   function *() {

    // });

    it('should authorize the transfer on the destination ledger',
      function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');

      const destinationTransferNock = nock(settlement.destination_transfer.id)
        .put('', _.merge(_.cloneDeep(settlement.destination_transfer), {
          debits: [{
            authorization: {
              algorithm: 'ed25519-sha512'
            }
          }]
        }))
        .reply(201, _.merge(_.cloneDeep(settlement.destination_transfer), {
          debits: [{
            authorization: {
              algorithm: 'ed25519-sha512'
            }
          }],
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201)
        .end();

      destinationTransferNock.done(); // Throw error if this wasn't called
    });

    it('should complete a settlement where the source transfer ' +
      'condition is the destination transfer', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: {
              signer: 'ledger.eu',
              messageHash: 'i2AsumK9qfwHO2iLlc3+kHNzBD6lRA8aucxzYMyOc6LG5/' +
                '9Yc5JHRmYCboIwypTFQsCeDlmHZMPPsQ4R5gX7yw=='
            }
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }
        }))
        .end();
    });

    it('should complete a settlement where the source transfer ' +
      'condition is equal to the destination transfer condition', function *() {

      const conditionMessage = {
        id: 'http://otherledger.com/transfers/' +
          'e80b0afb-f3dc-49d7-885c-fc802ddf4cc1',
        state: 'completed'
      };
      const condition = {
        signer: 'http://otherledger.com',
        messageHash: crypto.createHash('sha512')
          .update(JSON.stringify(conditionMessage))
          .digest('base64')
      };

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.execution_condition = condition;
      settlement.destination_transfer.execution_condition = condition;

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed',
          execution_condition_fulfillment: condition
        }));

      nock(settlement.source_transfer.id)
        .put('', _.merge(_.cloneDeep(settlement.source_transfer), {
          execution_condition_fulfillment: condition
        }))
        .reply(201, _.merge(_.cloneDeep(settlement.source_transfer), {
          state: 'completed',
          execution_condition_fulfillment: condition
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: condition
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: condition
          }
        }))
        .end();
    });

    it('should execute a settlement where its account is not the ' +
      'only credit in the source transfer', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.debits[0].amount = '21.07';
      settlement.source_transfer.credits.unshift({
        account: 'mary',
        amount: '20',
        asset: 'USD',
        ledger: 'ledger.us'
      });

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: {
              signer: 'ledger.eu',
              messageHash: 'i2AsumK9qfwHO2iLlc3+kHNzBD6lRA8aucxzYMyOc6LG5/' +
                '9Yc5JHRmYCboIwypTFQsCeDlmHZMPPsQ4R5gX7yw=='
            }
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }
        }))
        .end();
    });

    it('should execute a settlement where there are multiple debits ' +
      'from its account in the destination transfer', function *() {

      // Note there is no good reason why this should happen but we should
      // be able to handle it appropriately anyway

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.destination_transfer.debits[0].amount = '0.60';
      settlement.destination_transfer.debits.push({
        account: 'mark',
        amount: '0.40',
        asset: 'EUR',
        ledger: 'ledger.us'
      });

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: {
              signer: 'ledger.eu',
              messageHash: 'i2AsumK9qfwHO2iLlc3+kHNzBD6lRA8aucxzYMyOc6LG5/' +
                '9Yc5JHRmYCboIwypTFQsCeDlmHZMPPsQ4R5gX7yw=='
            }
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }
        }))
        .end();
    });

    it('should execute a settlement where there are multiple credits ' +
      'in the destination transfer', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.destination_transfer.credits[0].amount = '0.60';
      settlement.destination_transfer.credits.push({
        account: 'timothy',
        amount: '0.40',
        asset: 'EUR',
        ledger: 'ledger.us'
      });

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed'
        }));

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: {
              signer: 'ledger.eu',
              messageHash: 'i2AsumK9qfwHO2iLlc3+kHNzBD6lRA8aucxzYMyOc6LG5/' +
                '9Yc5JHRmYCboIwypTFQsCeDlmHZMPPsQ4R5gX7yw=='
            }
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }
        }))
        .end();
    });

  });

});
