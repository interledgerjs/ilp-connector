const IlpPacket = require('ilp-packet')
const Ildcp = require('ilp-protocol-ildcp')
const crypto = require('crypto')
const uuid = require('uuid/v4')
function sha256 (preimage) { return crypto.createHash('sha256').update(preimage).digest() }
const launch = require('./helpers/launch')

const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)
console.log({ fulfillment, condition })

const prepare = IlpPacket.serializeIlpForwardedPayment({
  account: 'test.quickstart.bob', // didn't manage yet to obtain this with IL-DCP through an LPI v1 mirror plugin
  data: Buffer.from(['hello world']),
})
const fulfillData = IlpPacket.serializeIlpFulfillment({
  data: Buffer.from('thank you')
})

// ...
launch('ilp-plugin-mirror-v1').then(connector => {
  connector.getPlugin('alice').oldPlugin.mirror.on('outgoing_fulfill', (transfer, fulfillment) => {
    console.log('It worked!', Buffer.from(fulfillment, 'base64'))
    connector.shutdown()
  })
  connector.getPlugin('bob').oldPlugin.mirror.on('incoming_prepare', (transfer) => {
    console.log('prepare showed up at bob!', transfer)
    connector.getPlugin('bob').oldPlugin.mirror.fulfillCondition(transfer.id, fulfillment.toString('base64'), fulfillData)
  })
  connector.getPlugin('alice').oldPlugin.mirror.sendTransfer({
    amount: '10',
    from: 'me',
    to: 'you',
    id: uuid(),
    executionCondition: condition.toString('base64'),
    expiresAt: new Date(new Date().getTime() + 10000),
    ilp: prepare.toString('base64')
  })
})
