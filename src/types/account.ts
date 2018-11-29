import { EventEmitter } from 'events'
import { IlpPacketHander } from 'ilp-packet'
import { MoneyHandler } from './plugin'

export interface AccountInfo {
  relation: 'parent' | 'peer' | 'child',
  assetCode: string,
  assetScale: number,
  plugin?: string | { [k: string]: any },
  balance?: {
    minimum?: string,
    maximum: string,
    settleThreshold?: string,
    settleTo?: string
  },
  maxPacketAmount?: string,
  throughput?: {
    refillPeriod?: number,
    incomingAmount?: string,
    outgoingAmount?: string
  },
  rateLimit?: {
    refillPeriod?: number,
    refillCount?: number,
    capacity?: number
  },
  options?: object,
  sendRoutes?: boolean,
  receiveRoutes?: boolean,
  ilpAddressSegment?: string
}

export default interface Account extends EventEmitter {
  readonly id: string,
  readonly info: AccountInfo,
  startup (): Promise<void>,
  shutdown (): Promise<void>,
  on (event: 'connect' | 'disconnect', listener: () => void): this
  once (event: 'connect' | 'disconnect', listener: () => void): this
  removeListener (event: 'connect' | 'disconnect', listener: () => void): this

  /**
   * Register a handler for ILP prepare packets coming from the account entity
   * @param handler An ILP Prepare packet handler
   */
  registerIlpPacketHandler (handler: IlpPacketHander): void,
  /**
   * Remove the currently registered handler
   */
  deregisterIlpPacketHandler (): void,
  /**
   * Send an ILP prepare to the account entity
   * @param packet An ILP prepare packet
   */
  sendIlpPacket: IlpPacketHander,

  /**
   * Register a handler for ILP prepare packets coming from the account entity
   * @param handler An ILP Prepare packet handler
   */
  registerMoneyHandler (handler: MoneyHandler): void,
  /**
   * Remove the currently registered handler
   */
  deregisterIlpPacketHandler (): void,
  /**
   * Send an ILP prepare to the account entity
   * @param packet An ILP prepare packet
   */
  sendMoney (amount: string): Promise<void>,
  /**
   * Is the account entity connected
   */
  isConnected (): boolean,
}
