const IlpPacket = require('ilp-packet')
const Ildcp = require('ilp-protocol-ildcp')
const crypto = require('crypto')
function sha256 (preimage) { return crypto.createHash('sha256').update(preimage).digest() }
const launch = require('./helpers/launch')

const fulfillment = crypto.randomBytes(32)
const condition = sha256(fulfillment)
console.log({ fulfillment, condition })

const fulfill = IlpPacket.serializeIlpFulfill({
  fulfillment,
  data: Buffer.from('thank you')
})

// ...
launch('ilp-plugin-mirror').then(connector => {
  connector.getPlugin('bob').mirror.registerDataHandler(data => {
    console.log('data showed up at bob!', data)
    return fulfill
  })
  connector.getPlugin('bob').mirror.registerMoneyHandler(amount => {
    console.log('money showed up at bob!', amount)
  })
  connector.getPlugin('bob').mirror.sendData(Ildcp.serializeIldcpRequest()).then(fulfill => {
    const bobInfo = Ildcp.deserializeIldcpResponse(fulfill)
    const prepare = IlpPacket.serializeIlpPrepare({
      amount: '10',
      executionCondition: condition,
      destination: bobInfo.clientAddress,
      data: Buffer.from(['hello world']),
      expiresAt: new Date(new Date().getTime() + 10000)
    })
    connector.getPlugin('alice').mirror.sendData(prepare).then(fulfillmentPacket => {
      console.log('It worked!', IlpPacket.deserializeIlpFulfill(fulfillmentPacket).fulfillment)
      connector.shutdown()
    })
  })
})
