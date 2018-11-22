import { IlpPrepare, IlpFulfill, IlpReject, deserializeIlpPacket, serializeIlpFulfill, serializeIlpReject, IlpErrorClass } from 'ilp-packet'

export type AnyIlpPacket = IlpPrepare | IlpFulfill | IlpReject

export type IlpReply = IlpFulfill | IlpReject

export function deserializeIlpReply (data: Buffer): IlpReply {
  return deserializeIlpPacket(data).data as IlpReply
}

export function serializeIlpReply (packet: IlpReply): Buffer {
  return isFulfill(packet) ? serializeIlpFulfill(packet) : serializeIlpReject(packet)
}

export const errorToIlpReject = (address: string, error: IlpErrorClass): IlpReject => {
  return {
    code: error.ilpErrorCode || 'F00',
    triggeredBy: address,
    message: error.message || '',
    data: error.ilpErrorData || Buffer.alloc(0)
  }
}

export function isFulfill (packet: IlpReply): packet is IlpFulfill {
  return typeof packet['fulfillment'] !== 'undefined'
}

export function isReject (packet: IlpReply): packet is IlpReject {
  return typeof packet['code'] !== 'undefined'
}
