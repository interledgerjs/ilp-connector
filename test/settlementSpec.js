/*global describe, it*/
/*eslint-disable no-multi-str*/
/*eslint max-nested-callbacks: [4]*/
'use strict';
const _ = require('lodash');
const crypto = require('crypto');
const expect = require('chai').expect;
const nock = require('nock');
nock.enableNetConnect(['localhost']);
const config = require('../services/config');
config.tradingPairs = require('./data/tradingPairs');
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

      this.settlementOneToOne =
        _.cloneDeep(require('./data/settlementOneToOne.json'));
      this.settlementSameExecutionCondition =
        _.cloneDeep(require('./data/settlementSameExecutionCondition.json'));
      this.settlementOneToMany =
        _.cloneDeep(require('./data/settlementOneToMany.json'));
      this.settlementManyToOne =
        _.cloneDeep(require('./data/settlementManyToOne.json'));
      this.settlementManyToMany =
        _.cloneDeep(require('./data/settlementManyToMany.json'));
      this.transferProposedReceipt =
        _.cloneDeep(require('./data/transferStateProposed.json'));
      this.transferExecutedReceipt =
        _.cloneDeep(require('./data/transferStateExecuted.json'));

      nock.cleanAll();

      nock('http://api.fixer.io/latest')
        .get('')
        .times(3)
        .reply(200, ratesResponse);
    });

    it('should return a 400 if the id is not a valid uuid', function *() {
      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
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

    it('should return a 422 if the settlement includes multiple ' +
      'source transfers and multiple destination transfers', function *() {

      // Note this behavior may be supported by other traders but not this one

      const settlement = this.formatId(this.settlementManyToMany,
        '/settlements/');

      yield this.request()
        .put('/settlements/' + this.settlementManyToMany.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('ManyToManyNotSupportedError');
          expect(res.body.message).to.equal('This trader does not support ' +
            'settlements that include multiple source transfers and ' +
            'multiple destination transfers');
        })
        .end();
    });

    it('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the public key of the ' +
      'destination ledger', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      settlement.source_transfers[0].execution_condition =
        _.assign({}, settlement.source_transfers[0].execution_condition, {
          public_key: 'Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg='
        });

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableConditionsError');
          expect(res.body.message).to.equal('Source transfer execution ' +
            'condition public key must match the destination ledger\'s.');
        })
        .end();
    });

    it.skip('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the same algorithm the' +
      'destination ledger uses');

    it('should return a 422 if the settlement does not include the ' +
      'trader in the source transfer credits', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].credits[0].account = 'mary';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('NoRelatedSourceCreditError');
          expect(res.body.message).to.equal('Trader\'s account must be ' +
            'credited in all source transfers to provide settlement');
        })
        .end();
    });

    it('should return a 422 if the settlement does not include the ' +
      'trader in the destination transfer debits', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.destination_transfers[0].debits[0].account = 'mary';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('NoRelatedDestinationDebitError');
          expect(res.body.message).to.equal('Trader\'s account must be ' +
            'debited in all destination transfers to provide settlement');
        })
        .end();
    });

    it('should return a 422 if the rate of the settlement is worse than ' +
      'the one currently offered', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].credits[0].amount = '1.00';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableRateError');
          expect(res.body.message).to.equal('Settlement rate does not match ' +
            'the rate currently offered');
        })
        .end();
    });

    it('should return a 422 if the rate of the settlement with multiple ' +
      'source transfers is worse than the one currently offered', function *() {

      const settlement = this.formatId(this.settlementManyToOne,
        '/settlements/');

      settlement.source_transfers[1].debits[0].amount = '6.75';
      settlement.source_transfers[1].credits[0].amount = '6.75';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnacceptableRateError');
          expect(res.body.message).to.equal('Settlement rate does not match ' +
            'the rate currently offered');
        })
        .end();
    });

    it('should return a 422 if the rate of the settlement with multiple ' +
      'destination transfers is worse than the one currently offered',
      function *() {

      const settlement = this.formatId(this.settlementOneToMany,
        '/settlements/');

      settlement.destination_transfers[1].debits[0].amount = '31';
      settlement.destination_transfers[1].credits[0].amount = '31';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
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
      'in an attempt to cheat the trader', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].debits.push(
        settlement.source_transfers[0].credits[0]);
      settlement.source_transfers[0].credits.push(
        settlement.source_transfers[0].debits[0]);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('NoRelatedSourceCreditError');
          expect(res.body.message).to.equal('Trader\'s account must be ' +
            'credited in all source transfers to provide settlement');
        })
        .end();
    });

    it('should return a 422 if the settlement includes assets this trader ' +
      'does not offer rates between', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].ledger = 'http://abc-ledger.example/ABC';
      settlement.destination_transfers[0].ledger =
        'http://xyz-ledger.example/XYZ';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('AssetsNotTradedError');
          expect(res.body.message).to.equal('This trader does not support ' +
          'the given asset pair');
        })
        .end();
    });

    it('should return a 422 if the source_transfer is not in the prepared ' +
      'or executed state', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].state = 'proposed';

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
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

      this.settlementOneToOne.id = this.settlementOneToOne.id.toUpperCase();
      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201)
        .expect(function(res) {
          expect(res.body.id).to.equal(settlement.id.toLowerCase());
        })
        .end();
    });

    it('should return a 201 for a new settlement', function *() {
      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201)
        .end();
    });

    // it('should return an error for a UUID that has already been used',
    //   function *() {

    // });

    it('should authorize the transfer on the destination ledger',
      function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      // we're testing to make sure this nock gets called
      const destinationTransferNock =
        nock(settlement.destination_transfers[0].id)
        .put('', _.merge(_.cloneDeep(settlement.destination_transfers[0]), {
          debits: [{
            authorization: {
              algorithm: 'ed25519-sha512'
            }
          }]
        }))
        .reply(201, _.merge(_.cloneDeep(settlement.destination_transfers[0]), {
          debits: [{
            authorization: {
              algorithm: 'ed25519-sha512'
            }
          }],
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        // .expect(201)
        .end();

      destinationTransferNock.done(); // Throw error if this wasn't called
    });

    it('should execute a settlement where the source transfer ' +
      'condition is the destination transfer', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: {
              signature: this.transferExecutedReceipt.signature
            }
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }]
        }))
        .end();
    });

    it('should execute a settlement where the source transfer ' +
      'condition is equal to the destination transfer condition', function *() {

      // secret: zU/Q8UzeDi4gHeKAFus1sXDNJ+F7id2AdMR8NXhe1slnYVZLVcvPzA2lFFdxef3y0LrIiuCV8jzs6yYDclN8yA==
      const fulfillment = {
        signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOM' +
          'pqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
      };

      const settlement = this.formatId(this.settlementSameExecutionCondition,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.source_transfers[0].id)
        .put('', _.merge(_.cloneDeep(settlement.source_transfers[0]), {
          execution_condition_fulfillment: fulfillment
        }))
        .reply(201, _.merge(_.cloneDeep(settlement.source_transfers[0]), {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: fulfillment
          }]
        }))
        .end();
    });

    it('should execute a settlement where its account is not the ' +
      'only credit in the source transfer', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.source_transfers[0].debits[0].amount = '21.07';
      settlement.source_transfers[0].credits.unshift({
        account: 'mary',
        amount: '20',
      });

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: {
              signature: this.transferExecutedReceipt.signature
            }
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }]
        }))
        .end();
    });

    it('should execute a settlement where there are multiple debits ' +
      'from its account in the destination transfer', function *() {

      // Note there is no good reason why this should happen but we should
      // be able to handle it appropriately anyway

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.destination_transfers[0].debits[0].amount = '0.60';
      settlement.destination_transfers[0].debits.push({
        account: 'mark',
        amount: '0.40',
      });

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: {
              signature: this.transferExecutedReceipt.signature
            }
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }, {
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }]
        }))
        .end();
    });

    it('should execute a settlement where there are multiple credits ' +
      'in the destination transfer', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.destination_transfers[0].credits[0].amount = '0.60';
      settlement.destination_transfers[0].credits.push({
        account: 'timothy',
        amount: '0.40'
      });

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: {
              signature: this.transferExecutedReceipt.signature
            }
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }]
        }))
        .end();
    });

    it('should only add authorization to the destination transfer ' +
      'debits from the trader\'s account', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');
      settlement.destination_transfers[0].debits.unshift({
        amount: '10',
        account: 'other'
      });
      settlement.destination_transfers[0].credits.unshift({
        amount: '10',
        account: 'jane'
      });

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt);

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: {
              signature: this.transferExecutedReceipt.signature
            }
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{}, // Don't add anything to the first one
            {
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }]
          }]
        }))
        .end();
    });

    it('should execute a settlement with one source transfer and multiple ' +
      'destination transfers', function *() {

      const settlement = this.formatId(this.settlementOneToMany,
        '/settlements/');

      const fulfillment = {
        signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
          'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
      };

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.destination_transfers[1].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[1], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: fulfillment
          }, {
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: fulfillment
          }]
        }))
        .end();
    });

    it('should execute a settlement with multiple source transfers and one ' +
      'destination transfer', function *() {

      const settlement = this.formatId(this.settlementManyToOne,
        '/settlements/');

      const fulfillment = {
        signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
          'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
      };

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      nock(settlement.source_transfers[1].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed',
          execution_condition_fulfillment: fulfillment
        }));

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201, _.merge(_.cloneDeep(settlement), {
          state: 'executed',
          source_transfers: [{
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }, {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorization: {
                algorithm: 'ed25519-sha512'
              }
            }],
            execution_condition_fulfillment: fulfillment
          }]
        }))
        .end();
    });

  });

});
