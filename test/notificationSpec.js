/*global describe, it*/
/*eslint-disable no-multi-str*/
/*eslint max-nested-callbacks: [4]*/
'use strict';
const _ = require('lodash');
const nock = require('nock');
const config = require('../services/config');
config.tradingPairs = require('./data/tradingPairs');
const app = require('../app');
const ratesResponse = require('./data/fxRates.json');
const appHelper = require('./helpers/app');
const logHelper = require('@ripple/five-bells-shared/testHelpers/log');
const expect = require('chai').expect;
const sinon = require('sinon');

const START_DATE = 1434412800000; // June 16, 2015 00:00:00 GMT

describe('Notifications', function() {
  logHelper();

  describe('POST /notifications', function() {

    beforeEach(function() {
      appHelper.create(this, app);

      this.clock = sinon.useFakeTimers(START_DATE);

      this.settlementOneToOne =
        _.cloneDeep(require('./data/settlementOneToOne.json'));
      this.settlementSameExecutionCondition =
        _.cloneDeep(require('./data/settlementSameExecutionCondition.json'));
      this.settlementOneToMany =
        _.cloneDeep(require('./data/settlementOneToMany.json'));
      this.settlementManyToOne =
        _.cloneDeep(require('./data/settlementManyToOne.json'));
      this.transferProposedReceipt =
        _.cloneDeep(require('./data/transferStateProposed.json'));
      this.transferPreparedReceipt =
        _.cloneDeep(require('./data/transferStatePrepared.json'));
      this.transferExecutedReceipt =
        _.cloneDeep(require('./data/transferStateExecuted.json'));
      this.notificationNoConditionFulfillment =
        _.cloneDeep(require('./data/notificationNoConditionFulfillment.json'));
      this.notificationWithConditionFulfillment =
        _.cloneDeep(require('./data/notificationWithConditionFulfillment.json'));

      nock('http://api.fixer.io/latest')
        .get('')
        .times(3)
        .reply(200, ratesResponse);
    });

    afterEach(function() {
      nock.cleanAll();
      this.clock.restore();
    });

    it('should return a 400 if the notification does not have an id field',
      function *() {

      delete this.notificationNoConditionFulfillment.id;
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end();
    });

    it('should return a 400 if the notification has an invalid id field',
      function *() {

      this.notificationNoConditionFulfillment.id =
        '96bdd66f-f37a-4be2-a7b0-4a449d78cd33';
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end();
    });

    it('should return a 400 if the notification does not have an event field',
      function *() {

      delete this.notificationNoConditionFulfillment.event;
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end();
    });

    it('should return a 400 if the notification has an invalid event field',
      function *() {

      this.notificationNoConditionFulfillment.event = 'hello there';
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end();
    });

    it('should return a 400 if the resource field is not a valid transfer',
      function *() {

      this.notificationNoConditionFulfillment.resource.additional_field =
        'blah';
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end();
    });

    it('should return a 422 if the notification is not related to a ' +
      'settlement the trader has participated in', function *() {

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(422)
        .expect(function(res) {
          expect(res.body.id).to.equal('UnrelatedNotificationError');
          expect(res.body.message).to.equal('Notification does not match a ' +
            'settlement we have a record of or the corresponding source ' +
            'transfers may already have been executed');
        })
        .end();
    });

    it('should return a 200 if the notification is properly formatted',
      function *() {

      const settlement = this.formatId(this.settlementSameExecutionCondition,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(this.notificationWithConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementSameExecutionCondition.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .end();
    });

    it('should submit the source transfer corresponding to the ' +
      'destination transfer it is notified about if its execution ' +
      'condition is the destination transfer', function *() {

      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      let sourceTransferExecuted = nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment: {
            signature: this.transferExecutedReceipt.signature
          }
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(this.notificationNoConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(200)
        .end();

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.isDone();

    });

    it('should submit the source transfer corresponding to the ' +
      'destination transfer it is notified about if the execution ' +
      'conditions are the same', function *() {

      const settlement = this.formatId(this.settlementSameExecutionCondition,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      let sourceTransferExecuted = nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      nock(this.notificationWithConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementSameExecutionCondition.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end();

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.isDone();

    });

    it('should submit multiple source transfers if there are multiple ' +
      'that correspond to a single destination transfer it is notified about',
      function *() {

      const settlement = this.formatId(this.settlementManyToOne,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      let firstSourceTransferExecuted = nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));
      let secondSourceTransferExecuted = nock(settlement.source_transfers[1].id)
        .put('', _.assign({}, settlement.source_transfers[1], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[1], {
          state: 'executed'
        }));

      nock(this.notificationWithConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementManyToOne.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end();

      // Throw an error if this nock hasn't been executed
      firstSourceTransferExecuted.isDone();
      secondSourceTransferExecuted.isDone();
    });

    it('should submit multiple source transfers with the right execution ' +
      'conditions even if one has the same condition as the destination ' +
      'transfer and another\'s condition is the destination transfer itself',
      function *() {

      const settlement = this.formatId(this.settlementManyToOne,
        '/settlements/');
      settlement.source_transfers[0].execution_condition =
        this.settlementOneToOne.source_transfers[0].execution_condition;

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt);

      let firstSourceTransferExecuted = nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment:{
            signature: this.transferExecutedReceipt.signature
          }
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));
      let secondSourceTransferExecuted = nock(settlement.source_transfers[1].id)
        .put('', _.assign({}, settlement.source_transfers[1], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[1], {
          state: 'executed'
        }));

      nock(this.notificationWithConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementManyToOne.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end();

      // Throw an error if this nock hasn't been executed
      firstSourceTransferExecuted.isDone();
      secondSourceTransferExecuted.isDone();

    });

    it('should delete the subscription once it has submitted the source ' +
      'transfers', function *() {

      const settlement = this.formatId(this.settlementSameExecutionCondition,
        '/settlements/');

      nock(settlement.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'prepared'
        }));

      nock(settlement.source_transfers[0].id)
        .put('', _.assign({}, settlement.source_transfers[0], {
          execution_condition_fulfillment:
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment
        }))
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }));

      let subscriptionDeleted = nock(this.notificationWithConditionFulfillment.id)
        .delete('')
        .reply(200);

      yield this.request()
        .put('/settlements/' + this.settlementSameExecutionCondition.id)
        .send(settlement)
        .expect(201)
        .end();

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end();

      // Throw an error if this nock hasn't been executed
      subscriptionDeleted.isDone();
    });

  });
});
