import { AccountInfo } from './accounts'
import { IlpPrepare, IlpReply, IlpPacketHander } from 'ilp-packet'
import { MoneyHandler } from './plugin'

export interface AccountService {
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
  sendIlpPacket (packet: IlpPrepare): Promise<IlpReply>,

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
