'use strict'

const IlpPacket = require("ilp-packet")

const Config = require('../../build/services/config').default
const assert = require('assert')
const reduct = require('reduct')
const logHelper = require('../helpers/log')
const logger = require('../../build/common/log')
const LoopBackAccountService = require('../../build/accounts/loop-back').default
const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('loop back account service', function () {

  describe('sendIlpPacket', function () {
    it('creates a IlpFulfill packet where the fulfillment is taken from the data of the IlpPrepare packet ', async function () {
      const preparePacket = {
        amount: '100',
        executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test2.bob',
        data: Buffer.alloc(0)
      }

      const loopBackAccount = new LoopBackAccountService('test', {
          plugin: 'ilp-plugin-btp',
          relation: 'child',
          assetCode: 'USD',
          assetScale: 10
      })

      const response = await loopBackAccount.sendIlpPacket(preparePacket)

      assert.deepStrictEqual({fulfillment: Buffer.alloc(0), data: Buffer.allocUnsafe(0)}, response)
    })
  })

})