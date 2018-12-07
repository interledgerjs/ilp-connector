import { EventEmitter } from 'events'
import { IlpPacketHander } from 'ilp-packet'
import { MoneyHandler } from './plugin'
import { AccountConfig } from '../schemas/Config'

export interface AccountInfo extends AccountConfig {
  // This allows space to extend the runtime object interface beyond what is defined in the schema
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
