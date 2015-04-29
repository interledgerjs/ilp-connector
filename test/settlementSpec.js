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

// ledger.eu public key: Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c=
// ledger.eu secret: u3HFmtkEHDCNJQwKGT4UfGf0TBqiqDu/2IY7R99Znvsu9/di2ccswRH5UdPRpp4QkX7tZBy+niIpkB28xW2jtw==

describe('Settlements', function () {

  describe('PUT /settlements/:id', function () {

    beforeEach(function() {
      logHelper();
      appHelper.create(this, app);

      this.basicSettlement = _.cloneDeep(require('./data/settlement1.json'));
      this.settlementWithEqualConditions = _.cloneDeep(require('./data/settlement2.json'));
      this.transferProposedReceipt = _.cloneDeep(require('./data/transferStateProposed.json'));
      this.transferCompletedReceipt = _.cloneDeep(require('./data/transferStateCompleted.json'));

      nock.cleanAll();

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

    it('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one is not the completion ' +
      'of the destination transfer', function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');

      settlement.source_transfer.execution_condition =
        _.assign({}, settlement.source_transfer.execution_condition, {
          public_key: 'Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg='
        });

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

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

    it('should return a 422 if the source_transfer is not in the prepared or completed state',
      function *() {

      const settlement = this.formatId(this.basicSettlement, '/settlements/');
      settlement.source_transfer.state = 'proposed';

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('FundsNotHeldError');
          expect(res.body.message).to.equal('Source transfer ' +
            'must be in the prepared state for the trader ' +
            'to authorize the destination transfer');
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201)
        .expect(function(res) {
          expect(res.body.id).to.equal(settlement.id.toLowerCase());
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

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

      // we're testing to make sure this nock gets called
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.source_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfer, {
          state: 'completed'
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        // .expect(201)
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: this.transferCompletedReceipt
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

      // secret: zU/Q8UzeDi4gHeKAFus1sXDNJ+F7id2AdMR8NXhe1slnYVZLVcvPzA2lFFdxef3y0LrIiuCV8jzs6yYDclN8yA==
      const fulfillment = {
        signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
      };

      const settlement = this.formatId(this.settlementWithEqualConditions, '/settlements/');

      nock(settlement.destination_transfer.id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfer, {
          state: 'completed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.source_transfer.id)
        .put('', _.merge(_.cloneDeep(settlement.source_transfer), {
          execution_condition_fulfillment: fulfillment
        }))
        .reply(201, _.merge(_.cloneDeep(settlement.source_transfer), {
          state: 'completed',
          execution_condition_fulfillment: fulfillment
        }));

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: fulfillment
          },
          destination_transfer: {
            state: 'completed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: fulfillment
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: this.transferCompletedReceipt
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: this.transferCompletedReceipt
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

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfer.id)
        .get('/state')
        .reply(200, this.transferCompletedReceipt);

      yield this.request()
        .put('/settlements/' + this.basicSettlement.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'completed',
          source_transfer: {
            state: 'completed',
            execution_condition_fulfillment: this.transferCompletedReceipt
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
