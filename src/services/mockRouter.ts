import { Router, RequestHandler } from "../types/router";
import { IlpPrepare, IlpReply, IlpFulfill } from "ilp-packet";
import { create as createLogger } from '../common/log'
const log = createLogger('mock-ilp-router')

export default class MockRouter implements Router {

  private peers: Map<string, RequestHandler>

  constructor () {
    this.peers = new Map()
  }

  addPeer (name: string, handler: RequestHandler) {
    log.info(`adding peer ${name}`)
    this.peers.set(name, handler)
  }

  removePeer (name: string) {
    log.info(`removing peer ${name}`)
  }

  async request (packet: IlpPrepare): Promise<IlpReply> {
    log.info(`Received request. sending packet: ${JSON.stringify(packet)}`)
    const reply = {
      fulfillment: Buffer.alloc(32),
      data: Buffer.alloc(0)
    } as IlpFulfill

    return reply
  }

  setAddress (address: string) {
    
  }
}
