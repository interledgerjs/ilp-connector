'use strict'

const Config = require("../../build/services/config").default
const assert = require('assert')
const reduct = require('reduct')
const logHelper = require('../helpers/log')
const logger = require('../../build/common/log')
const ServerAccountProvider = require('../../build/account-providers/server.js').default
const tokenToAccount = require('../../build/account-providers/server.js').tokenToAccount
const BtpPacket = require('btp-packet')
const WebSocket = require('ws')

async function sendAuthPacket (serverUrl, account, token) {
  const protocolData = [{
    protocolName: 'auth',
    contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
    data: Buffer.from([])
  }]

  if(account) protocolData.push({
    protocolName: 'auth_username',
    contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
    data: Buffer.from(account, 'utf8')
  })

  if(token) protocolData.push({
    protocolName: 'auth_token',
    contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
    data: Buffer.from(token, 'utf8')
  })

  const ws = new WebSocket(serverUrl)
  await new Promise((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', (err) => reject(err))
  })


  const result = new Promise((resolve) => {
    ws.on('message', (msg) => {
      resolve(BtpPacket.deserialize(msg))
      ws.close()
    })
  })

  await new Promise((resolve) => ws.send(BtpPacket.serialize({
    type: BtpPacket.TYPE_MESSAGE,
    requestId: 1,
    data: { protocolData }
  }), resolve))

  return result
}

describe('server provider', function () {
  logHelper(logger)
  beforeEach(async function () {
    const deps = reduct()
    this.config = deps(Config)
    this.config.store = "memdown"
    this.config.providerDefaultAccountInfo = {
      plugin: 'ilp-plugin-btp',
      relation: 'child',
      assetCode: 'USD',
      assetScale: 10,
    }
    this.serverUrl = 'ws://localhost:5555'
    this.provider = new ServerAccountProvider(deps)
    await this.provider.startup(async (account) => {this.account = account})
  })

  afterEach(async function () {
    this.account = undefined
    await this.provider.shutdown()
  })

  it('creates new plugin account service for new ws connection', async function () {
    await sendAuthPacket(this.serverUrl, 'test-account', 'test_token')
    assert.ok(this.account)
  })

  it('uses user_name as accountId if is set in auth message', async function () {
    await sendAuthPacket(this.serverUrl, 'test-account', 'test_token')
    assert.deepStrictEqual('test-account', this.account.id)
  })

  it('uses hashed token as accountId if is set in auth message', async function () {
    await sendAuthPacket(this.serverUrl, null, 'test_token')
    assert.deepStrictEqual(tokenToAccount('test_token'), this.account.id)
  })

})
