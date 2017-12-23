'use strict'

const IlpPacket = require('ilp-packet')
const { Writer } = require('oer-utils')
const { codes } = require('../lib/ilp-errors')
const debug = require('debug')('ilp-connector:peerProtocols')

const PEER_PROTOCOL_PREFIX = 'peer'
const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)

const isPeerProtocolPacket = (packetBinary) => {
  try {
    const { account: destination } = IlpPacket.deserializeIlpForwardedPayment(packetBinary)
    return destination.substring(0, PEER_PROTOCOL_PREFIX.length) === PEER_PROTOCOL_PREFIX
  } catch (err) {
    return false
  }
}

const processConfigRequest = ({ sourceAccount, data, fulfillment }) => {
  const clientName = sourceAccount

  debug('responding to config request, assigning client name ' + clientName)

  const writer = new Writer()
  writer.writeVarOctetString(Buffer.from(clientName, 'ascii'))
  return {
    fulfillment,
    ilp: IlpPacket.serializeIlpFulfillment({ data: writer.getBuffer() })
  }
}

const processPeerProtocolRequest = ({ sourceAccount, sourceTransfer, createIlpRejection }) => {
  const { account: destination, data } = IlpPacket.deserializeIlpForwardedPayment(sourceTransfer.ilp)

  debug('received request for peer protocol ' + destination)

  if (!PEER_PROTOCOL_CONDITION.equals(sourceTransfer.executionCondition)) {
    throw createIlpRejection({
      code: codes.F00_BAD_REQUEST,
      message: 'peer protocol transfer must use a specific condition. expected=' + PEER_PROTOCOL_CONDITION + ' actual=' + sourceTransfer.executionCondition
    })
  }

  switch (destination) {
    case 'peer.config':
      return processConfigRequest({
        sourceAccount,
        data,
        fulfillment: PEER_PROTOCOL_FULFILLMENT
      })
    default:
      debug('no handler found for this peer protocol, rejecting transfer')
      throw createIlpRejection({
        code: codes.F00_BAD_REQUEST,
        message: 'unknown peer protocol. peerProtocol=' + destination
      })
  }
}

module.exports = {
  isPeerProtocolPacket,
  processPeerProtocolRequest
}
