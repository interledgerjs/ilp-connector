'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const LiquidityCurve = require('../src/routing/liquidity-curve').default
const sinon = require('sinon')
const nock = require('nock')
const IlpPacket = require('ilp-packet')
nock.enableNetConnect(['localhost'])
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))
const RemoteQuoteError = require('../src/errors/remote-quote-error').default
const InvalidAmountSpecifiedError = require('../src/errors/invalid-amount-specified-error').default
const NoRouteFoundError = require('../src/errors/no-route-found-error').default
const UnacceptableAmountError = require('../src/errors/unacceptable-amount-error').default
const UnacceptableExpiryError = require('../src/errors/unacceptable-expiry-error').default
const LedgerNotConnectedError = require('../src/errors/ledger-not-connected-error').default
const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)
    this.clock = sinon.useFakeTimers(START_DATE)

    await this.middlewareManager.setup()
    await this.accounts.connect()
    const testAccounts = ['test.cad-ledger', 'test.usd-ledger', 'test.eur-ledger', 'test.cny-ledger']
    for (let accountId of testAccounts) {
      this.routeBroadcaster.add(accountId)
      this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: accountId,
          routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
          from_epoch: 0,
          to_epoch: 1,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: [{
            prefix: accountId,
            path: [accountId],
            auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
          }]
        }
      })))
    }

    await this.backend.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(function () {
    this.clock.restore()
    nock.cleanAll()
  })

  it('should return a InvalidAmountSpecifiedError if sourceAmount is zero', async function () {
    const quotePromise = this.routeBuilder.quoteBySource('test.eur-ledger', {
      sourceAmount: '0',
      destinationAccount: 'usd-ledger.bob'
    })

    await assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'sourceAmount must be positive')
  })

  it('should return a InvalidAmountSpecifiedError if destinationAmount is zero', async function () {
    const quotePromise = this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAmount: '0',
      destinationAccount: 'usd-ledger.bob'
    })

    await assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'destinationAmount must be positive')
  })

  it.skip('should return NoRouteFoundError when the destination amount is unachievable', async function () {
    const quotePromise = this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAmount: '100000000000000000000000000000',
      destinationAccount: 'usd-ledger.bob',
      destinationHoldDuration: 1.001
    })

    await assert.isRejected(quotePromise, NoRouteFoundError, 'no route found. to=usd-ledger.bob')
  })

  it('should return NoRouteFoundError when the source ledger is not supported', async function () {
    const quotePromise = this.routeBuilder.quoteBySource('test.fake-ledger', {
      sourceAmount: '100',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 1.001
    })

    await assert.isRejected(quotePromise, NoRouteFoundError, 'no route from source. sourceAccount=test.fake-ledger')
  })

  // Skipping because it needs to use an alternate curve to get a 0.
  it('should return a UnacceptableAmountError if the quoted destinationAmount is 0', async function () {
    const quotePromise = this.routeBuilder.quoteBySource('test.usd-ledger', {
      sourceAmount: '1',
      destinationAccount: 'test.eur-ledger.bob',
      destinationHoldDuration: 1.001
    })

    await assert.isRejected(quotePromise, UnacceptableAmountError, 'quoted destination is lower than minimum amount allowed.')
  })

  it('should return NoRouteFoundError when the destination ledger is not supported', async function () {
    const quotePromise = this.routeBuilder.quoteBySource('test.eur-ledger', {
      sourceAmount: '100',
      destinationAccount: 'test.fake.blah',
      destinationHoldDuration: 1.001
    })

    await assert.isRejected(quotePromise, NoRouteFoundError, 'no route found. to=test.fake.blah')
  })

  it('should return a UnacceptableExpiryError if the destinationHoldDuration is too long', async function () {
    const quotePromise = this.routeBuilder.quoteBySource('test.eur-ledger', {
      sourceAmount: '100',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 30001
    })

    await assert.isRejected(quotePromise, UnacceptableExpiryError, /destination expiry duration is too long/)
  })

  it('should not return an Error for insufficient liquidity', async function () {
    const quotePromise = this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAmount: '150001',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 10
    })

    await assert.isFulfilled(quotePromise)
  })

  it('should return quotes for fixed source amounts', async function () {
    const quote = await this.routeBuilder.quoteBySource('test.eur-ledger', {
      sourceAmount: '1000000',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5000
    })

    expect(quote).to.deep.equal({
      sourceHoldDuration: 6000,
      destinationAmount: '1057081' // EUR/USD Rate of 1.0592 - .2% spread
    })
  })

  // TODO: make sure we're calculating the rates correctly and in our favor
  it('should return quotes for fixed destination amounts', async function () {
    const quote = await this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAmount: '1000000',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      sourceAmount: '946001', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate
      sourceHoldDuration: 6000
    })
  })

  it('should return local liquidity curve quotes', async function () {
    const quote = await this.routeBuilder.quoteLiquidity('test.eur-ledger', {
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      liquidityCurve: new LiquidityCurve([ [ 1, 0 ], [ 94600076285502, 100000000000000 ] ]).toBuffer(),
      appliesToPrefix: 'test.usd-ledger',
      sourceHoldDuration: 6000,
      expiresAt: new Date(START_DATE + 45000)
    })
  })

  it('should return remote liquidity curve quotes', async function () {
    const curve = new LiquidityCurve([ [0, 0], [10000, 20000] ]).toBuffer()
    this.routeBroadcaster.config.routeBroadcastEnabled = false
    await this.ccpController.handle({
      speaker: 'test.eur-ledger',
      routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
      from_epoch: 1,
      to_epoch: 2,
      hold_down_time: 45000,
      withdrawn_routes: [],
      new_routes: [{
        prefix: 'test.random-ledger',
        path: ['test.eur-ledger', 'test.random-ledger'],
        auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
      }]
    }, 'test.eur-ledger')
    this.routeBroadcaster.config.routeBroadcastEnabled = true

    this.accounts.getPlugin('test.eur-ledger').sendData = () => IlpPacket.serializeIlqpLiquidityResponse({
      liquidityCurve: curve,
      appliesToPrefix: 'test.random-ledger',
      sourceHoldDuration: 6000,
      expiresAt: new Date(START_DATE + 45000)
    })

    const quote = await this.routeBuilder.quoteLiquidity('test.usd-ledger', {
      destinationAccount: 'test.random-ledger.carl',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      liquidityCurve: new LiquidityCurve([ [1, 0], [10614, 20000] ]).toBuffer(),
      appliesToPrefix: 'test.random-ledger',
      sourceHoldDuration: 7000,
      expiresAt: new Date(START_DATE + 45000)
    })
  })

  it('should return liquidity curve quotes with the correct appliesToPrefix', async function () {
    const curve = new LiquidityCurve([ [1, 0], [1001, 1000] ])
    for (let targetPrefix of ['', 'a', 'a.b']) {
      this.routingTable.insert(targetPrefix, {
        nextHop: 'test.eur-ledger',
        path: []
      })
      this.quoter.cacheCurve({
        prefix: targetPrefix,
        curve,
        expiry: Date.now() + 45000,
        minMessageWindow: 1000
      })
    }
    expect((await this.routeBuilder.quoteLiquidity('test.cad-ledger', {
      destinationAccount: 'random-ledger.carl',
      destinationHoldDuration: 5000
    })).appliesToPrefix).to.equal('random-ledger') // Can't be "", since that would match "eur-ledger.".
    expect((await this.routeBuilder.quoteLiquidity('test.cad-ledger', {
      destinationAccount: 'a.b.carl',
      destinationHoldDuration: 5000
    })).appliesToPrefix).to.equal('a.b')
    expect((await this.routeBuilder.quoteLiquidity('test.cad-ledger', {
      destinationAccount: 'a.c.b.carl',
      destinationHoldDuration: 5000
    })).appliesToPrefix).to.equal('a.c')
  })

  it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', async function () {
    const quote = await this.routeBuilder.quoteBySource('test.usd-ledger', {
      sourceAmount: '1000000',
      destinationAccount: 'test.eur-ledger.alice',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      destinationAmount: '942220', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
      sourceHoldDuration: 6000
    })
  })

  it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', async function () {
    const quote = await this.routeBuilder.quoteBySource('test.usd-ledger', {
      sourceAmount: '1000000',
      destinationAccount: 'test.cad-ledger.carl',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      destinationAmount: '1279818', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
      sourceHoldDuration: 6000
    })
  })

  it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', async function () {
    const quote = await this.routeBuilder.quoteBySource('test.cad-ledger', {
      sourceAmount: '1000000',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5000
    })
    expect(quote).to.deep.equal({
      destinationAmount: '778238', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
      sourceHoldDuration: 6000
    })
  })

  describe('if route has no curve, quotes a multi-hop route', function () {
    beforeEach(async function () {
      this.routeBroadcaster.config.routeBroadcastEnabled = false
      await this.ccpController.handle({
        speaker: 'test.eur-ledger',
        routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        from_epoch: 1,
        to_epoch: 2,
        hold_down_time: 45000,
        withdrawn_routes: [],
        new_routes: [{
          prefix: 'test.random-ledger',
          path: ['test.eur-ledger', 'test.random-ledger'],
          auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
        }]
      }, 'test.eur-ledger')
      this.routeBroadcaster.config.routeBroadcastEnabled = true
    })

    it('returns a quote when appliesToPrefix is more general than targetPrefix', async function () {
      this.accounts.getPlugin('test.eur-ledger').sendData = (request) => {
        assert.deepEqual(IlpPacket.deserializeIlqpLiquidityRequest(request), {
          destinationAccount: 'test.random-ledger.bob',
          destinationHoldDuration: 5000
        })
        return Promise.resolve(IlpPacket.serializeIlqpLiquidityResponse({
          liquidityCurve: new LiquidityCurve([ [0, 0], [1000, 2000] ]).toBuffer(),
          appliesToPrefix: 'random',
          sourceHoldDuration: 6000,
          expiresAt: new Date(START_DATE + 10000)
        }))
      }

      const quote = await this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.random-ledger.bob',
        destinationHoldDuration: 5000
      })
      expect(quote).to.deep.equal({
        destinationAmount: '188', // (100 / 1.0592) * 2
        sourceHoldDuration: 7000
      })
    })

    it('returns a quote when appliesToPrefix is more specific than targetPrefix', async function () {
      this.accounts.getPlugin('test.eur-ledger').sendData = (request) => {
        assert.deepEqual(IlpPacket.deserializeIlqpLiquidityRequest(request), {
          destinationAccount: 'test.random-ledger.bob',
          destinationHoldDuration: 5000
        })
        return Promise.resolve(IlpPacket.serializeIlqpLiquidityResponse({
          liquidityCurve: new LiquidityCurve([ [0, 0], [1000, 2000] ]).toBuffer(),
          appliesToPrefix: 'test.random-ledger.b',
          sourceHoldDuration: 6000,
          expiresAt: new Date(START_DATE + 10000)
        }))
      }

      const quote = await this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.random-ledger.bob',
        destinationHoldDuration: 5000
      })
      expect(quote).to.deep.equal({
        destinationAmount: '188', // (100 / 1.0592) * 2
        sourceHoldDuration: 7000
      })
    })

    it('relays an error packet', async function () {
      const errorPacket = IlpPacket.serializeIlpError({
        responseType: 8,
        code: 'F01',
        name: 'Invalid Packet',
        triggeredBy: 'example.us.ledger3.bob',
        forwardedBy: [ 'foo' ],
        triggeredAt: new Date(),
        data: JSON.stringify({ foo: 'bar' })
      })
      this.accounts.getPlugin('test.eur-ledger').sendData = (request) => {
        return Promise.resolve(errorPacket)
      }

      try {
        await this.routeBuilder.quoteBySource('test.usd-ledger', {
          sourceAmount: '100',
          destinationAccount: 'test.random-ledger.bob',
          destinationHoldDuration: 5000
        })
      } catch (err) {
        expect(err).to.be.instanceof(RemoteQuoteError)
        expect(err.message).to.deep.equal('remote quote error.')
        return
      }
      assert(false, 'should have thrown an error')
    })
  })

  it('support same-ledger quotes', async function () {
    const quote = await this.routeBuilder.quoteBySource('test.usd-ledger', {
      sourceAmount: '100',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5
    })
    expect(quote).to.deep.equal({
      destinationAmount: '99', // (100 / 1.0592) * 2
      sourceHoldDuration: 1005
    })
  })

  it('reject same-ledger quotes if CONNECTOR_REFLECT_PAYMENTS is false', async function () {
    this.config.reflectPayments = false
    const quotePromise = this.routeBuilder.quoteBySource('test.usd-ledger', {
      sourceAmount: '100',
      destinationAccount: 'test.usd-ledger.bob',
      destinationHoldDuration: 5
    })

    await assert.isRejected(quotePromise, NoRouteFoundError, 'refusing to route payments back to sender. sourceAccount=test.usd-ledger destinationAccount=test.usd-ledger.bob')
  })

  it('fails when the source ledger connection is closed', async function () {
    this.accounts.getPlugin('test.eur-ledger').connected = false
    const quotePromise = this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAccount: 'test.usd-ledger.bob',
      destinationAmount: '100',
      destinationHoldDuration: 5
    })

    await assert.isRejected(quotePromise, LedgerNotConnectedError, 'no connection to account. account=test.eur-ledger')
  })

  it('fails when the destination ledger connection is closed', async function () {
    this.accounts.getPlugin('test.usd-ledger').connected = false
    const quotePromise = this.routeBuilder.quoteByDestination('test.eur-ledger', {
      destinationAccount: 'test.usd-ledger.bob',
      destinationAmount: '100',
      destinationHoldDuration: 5
    })

    await assert.isRejected(quotePromise, LedgerNotConnectedError, 'no connection to account. account=test.usd-ledger')
  })
})
