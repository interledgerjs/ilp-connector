'use strict'

const IlpPacket = require('ilp-packet')
const Plugin = require('ilp-plugin-btp')
const { randomBytes, createHash } = require('crypto')
const ILDCP = require('ilp-protocol-ildcp')
const { Writer } = require('oer-utils')

const conditionMap = new Map()

const NODE_COUNT = 200

;(async () => {
  for (let i = 0; i < NODE_COUNT; i++) {
    const sender = new Plugin({
      server: 'btp+ws://:mini@localhost:' + (20000 + i)
    })

    console.log(`connecting to test.u${i}`)
    await sender.connect()

    const { clientAddress } = await ILDCP.fetch(sender.sendData.bind(sender))

    sender.registerDataHandler(data => {
      const { executionCondition } = IlpPacket.deserializeIlpPrepare(data)

      const fulfillment = conditionMap.get(executionCondition.toString('base64'))
      if (fulfillment) {
        return IlpPacket.serializeIlpFulfill({
          fulfillment: fulfillment,
          data: Buffer.alloc(0)
        })
      } else {
        throw new Error('unexpected packet.')
      }
    })

    for (let j = i; j < NODE_COUNT; j++) {
      const destination = `test.u${j}x`
      console.log(`test.u${i}x => ${destination}`)

      const fulfillment = randomBytes(32)
      const condition = createHash('sha256').update(fulfillment).digest()

      conditionMap.set(condition.toString('base64'), fulfillment)

      const writer = new Writer()

      writer.write(Buffer.from('ECHOECHOECHOECHO', 'ascii'))
      writer.writeUInt8(0)
      writer.writeVarOctetString(Buffer.from(clientAddress, 'ascii'))

      const result = await sender.sendData(IlpPacket.serializeIlpPrepare({
        destination,
        amount: '100',
        executionCondition: condition,
        expiresAt: new Date(Date.now() + 30000),
        data: writer.getBuffer()
      }))

      const parsedPacket = IlpPacket.deserializeIlpPacket(result)
      if (parsedPacket.type !== IlpPacket.Type.TYPE_ILP_FULFILL) {
        console.log(parsedPacket)
        process.exit(1)
      }
    }
  }
})()
  .catch(console.error)
