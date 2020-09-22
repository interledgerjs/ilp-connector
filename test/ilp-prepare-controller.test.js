'use strict'

const assert = require('assert')
const _ = require('lodash')
const appHelper = require('./helpers/app')
const logger = require('../dist/common/log')
const logHelper = require('./helpers/log')
const mockPlugin = require('./mocks/mockPlugin')
const sinon = require('sinon')
const mock = require('mock-require')
const IlpPacket = require('ilp-packet')
const { randomBytes, createHash } = require('crypto')
const { Writer } = require('oer-utils')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('IlpPrepareController', function () {
  logHelper(logger)

  before(async function () {
    mock('ilp-plugin-mock', mockPlugin)
  })

  beforeEach(async function () {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'mock.test1': {
        relation: 'peer',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          type: 'mock',
          host: 'http://test1.mock',
          account: 'xyz',
          username: 'bob',
          password: 'bob'
        }
      },
      'mock.test2': {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          type: 'mock',
          host: 'http://test2.mock',
          account: 'xyz',
          username: 'bob',
          password: 'bob'
        }
      }
    })
    process.env.CONNECTOR_ROUTES = JSON.stringify([{
      targetPrefix: 'mock.test1',
      peerId: 'mock.test1'
    }, {
      targetPrefix: 'mock.test2',
      peerId: 'mock.test2'
    }])

    appHelper.create(this)
    await this.backend.connect()
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()

    this.setTimeout = setTimeout
    this.setInterval = setInterval
    this.clock = sinon.useFakeTimers(START_DATE)

    this.mockPlugin1Wrapped = this.accounts.getPlugin('mock.test1')
    this.mockPlugin1 = this.mockPlugin1Wrapped.oldPlugin
    this.mockPlugin2Wrapped = this.accounts.getPlugin('mock.test2')
    this.mockPlugin2 = this.mockPlugin2Wrapped.oldPlugin
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  it('should pass on an execution condition fulfillment', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .resolves(fulfillPacket)

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it('should reject when given an invalid fulfillment', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .resolves(fulfillPacket)

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'F05',
      message: 'fulfillment did not match expected value.',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('applies its rate and reduces the expiry date by one second', async function () {
    const sendSpy = sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      }))

    await this.middlewareManager.setup()
    await this.mockPlugin1Wrapped._dataHandler(IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }))

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: '94',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 1000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }) || true))
  })

  it('reduces the destination expiry to its max hold time if that time would otherwise be exceeded', async function () {
    const sendSpy = sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
        data: Buffer.alloc(0)
      }))

    await this.middlewareManager.setup()
    await this.mockPlugin1Wrapped._dataHandler(IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 200000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }))

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: '94',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 30000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    }) || true))
  })

  it('rejects the source transfer if forwarding fails', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .rejects(new Error('fail!'))

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'F02',
      message: 'failed to send packet: fail!',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('fulfills the source transfer even if settlement fails', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(this.mockPlugin2Wrapped, 'sendData')
      .resolves(fulfillPacket)
    sinon.stub(this.mockPlugin2Wrapped, 'sendMoney')
      .rejects(new Error('fail!'))

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it('rejects with Insufficient Timeout if the incoming transfer is expired', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE - 1),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'R02',
      message: 'source transfer has already expired. sourceExpiry=2015-06-15T23:59:59.999Z currentTime=2015-06-16T00:00:00.000Z',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  it('rejects with Insufficient Timeout if the incoming transfer expires so soon we cannot create a destination transfer with a sufficient large expiry difference', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
      expiresAt: new Date(START_DATE + 1999),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })

    await this.middlewareManager.setup()
    const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

    assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
    assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
      code: 'R02',
      message: 'source transfer expires too soon to complete payment. actualSourceExpiry=2015-06-16T00:00:01.999Z requiredSourceExpiry=2015-06-16T00:00:02.000Z currentTime=2015-06-16T00:00:00.000Z',
      triggeredBy: 'test.connie',
      data: Buffer.alloc(0)
    })
  })

  describe('when rejected by next hop', function () {
    it('relays the interledger rejection', async function () {
      const rejection = {
        code: '123',
        triggeredBy: 'test.foo',
        message: 'Error 1',
        data: Buffer.alloc(0)
      }
      const rejectStub = sinon.stub(this.mockPlugin2Wrapped, 'sendData')
        .resolves(IlpPacket.serializeIlpReject(rejection))

      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '100',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test2.bob',
        data: Buffer.alloc(0)
      })

      await this.middlewareManager.setup()
      const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

      sinon.assert.calledOnce(rejectStub)
      assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
      assert.deepEqual(IlpPacket.deserializeIlpReject(result), rejection)
    })

    it('does not send funds', async function () {
      const dataStub = sinon.stub(this.mockPlugin2Wrapped, 'sendData')
        .resolves(IlpPacket.serializeIlpReject({
          code: '123',
          triggeredBy: 'test.foo',
          message: 'Error 1',
          data: Buffer.alloc(0)
        }))
      const moneyStub = sinon.stub(this.mockPlugin2Wrapped, 'sendMoney')

      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '100',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'mock.test2.bob',
        data: Buffer.alloc(0)
      })

      await this.middlewareManager.setup()
      await this.mockPlugin1Wrapped._dataHandler(preparePacket)

      sinon.assert.calledOnce(dataStub)
      sinon.assert.notCalled(moneyStub)
    })
  })

  describe('peer protocol', function () {
    beforeEach(function () {
      this.accounts.add('mock.test3', {
        relation: 'child',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      this.mockPlugin3 = this.mockPlugin3Wrapped.oldPlugin
    })

    it('handles ILDCP requests', async function () {
      const preparePacket = IlpPacket.serializeIlpPrepare({
        amount: '0',
        executionCondition: Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64'),
        expiresAt: new Date(START_DATE + 60000),
        destination: 'peer.config',
        data: Buffer.alloc(0)
      })
      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment: Buffer.alloc(32),
        data: Buffer.from('FnRlc3QuY29ubmllLm1vY2sudGVzdDMEA1VTRA==', 'base64')
      })

      await this.middlewareManager.setup()
      const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)
      assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
    })

    it('handles ping packets', async function () {
      const fulfillment = randomBytes(32)
      const executionCondition = createHash('sha256').update(fulfillment).digest()

      const writer = new Writer()
      writer.write(Buffer.from('ECHOECHOECHOECHO'))
      writer.writeInt8(0) // Ping
      writer.writeVarOctetString(Buffer.from('mock.test1')) // Original ILP address

      const pingPrepare = IlpPacket.serializeIlpPrepare({
        amount: '10',
        executionCondition,
        expiresAt: new Date(START_DATE + 60000),
        destination: 'test.connie', // Must be addressed directly to the connector
        data: writer.getBuffer()
      })

      const fulfillPacket = IlpPacket.serializeIlpFulfill({
        fulfillment,
        data: Buffer.alloc(0)
      })

      Object.assign(this.mockPlugin1Wrapped, {
        async sendData (data) {
          const pongPrepare = IlpPacket.deserializeIlpPrepare(data)

          assert(pongPrepare.data.equals(Buffer.concat([
            Buffer.from('ECHOECHOECHOECHO'),
            Buffer.from([1]) // Pong
          ])))
          assert(pongPrepare.executionCondition.equals(executionCondition))
          assert.equal(parseInt(pongPrepare.amount), 9) // Ensure slippage was applied

          return fulfillPacket
        }
      })

      await this.middlewareManager.setup()
      const result = await this.mockPlugin1Wrapped._dataHandler(pingPrepare)
      assert.equal(result.toString('hex'), fulfillPacket.toString('hex')) // Ensures data handler is called
    })
  })
})
