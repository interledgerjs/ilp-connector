'use strict'

const IlpPacket = require("ilp-packet")

const sinon = require('sinon')
const assert = require('assert')
const logHelper = require('../helpers/log')
const logger = require('../../build/common/log')
const baseAccountService = require('../../build/accounts/base').AccountBase
const mockIlpEndpoint = require('../mocks/mockIlpEndpoint')

describe('base account service', function () {
  logHelper(logger)
  
  beforeEach(function () {
    const accountConfig = {
      relation: 'peer',
      assetScale: 2,
      assetCode: 'USD',
      plugin: 'ilp-plugin-btp'
    }
    this.baseAccount = new baseAccountService('test', accountConfig)
  })

  afterEach(function () {
    this.baseAccount = undefined
  })

  describe('registerIlpEndpoint', function () {
    it('throws error if account is already started ', async function () {
      this.baseAccount.startup()
      const handlerProvider = () => {}
      const endpoint = new mockIlpEndpoint(handlerProvider)

      try {
        this.baseAccount.registerIlpEndpoint(endpoint)
      } catch (e) {
        assert.ok(!this.baseAccount.endpoint)
        return
      }

      assert.fail('did not throw exception')
    })
  })

  describe('startup', function () {
    it('sets the handler provider on the ilp endpoint to point to the incoming middleware', async function () {
      
    })
  })

})