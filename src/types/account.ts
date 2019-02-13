import { EventEmitter } from 'events'
import { IlpPacketHander } from 'ilp-packet'
import { AccountConfig } from '../schemas/Config'
import { IlpEndpoint, RequestHandler } from './ilp-endpoint';

export interface AccountInfo extends AccountConfig {
  // This allows space to extend the runtime object interface beyond what is defined in the schema
}

export interface AccountMiddlewarePipelines {
  incomingIlpPacketPipeline: RequestHandler,
  outgoingIlpPacketPipeline: RequestHandler,
  startupPipeline: (param: void) => Promise<void>,
  shutdownPipeline: (param: void) => Promise<void>
}

export default interface Account extends EventEmitter {
  readonly id: string,
  readonly info: AccountInfo,
  endpoint?: IlpEndpoint,
  startup (): Promise<void>,
  shutdown (): Promise<void>,
  on (event: 'connect' | 'disconnect', listener: () => void): this
  once (event: 'connect' | 'disconnect', listener: () => void): this
  removeListener (event: 'connect' | 'disconnect', listener: () => void): this,

  /**
   * Register an ilp endpoint for the account
   * @param endpoint An ILP Endpoint
   */
  registerIlpEndpoint (endpoint: IlpEndpoint): void,
  /**
   * Register the middleware pipelines for the account
   * @param middlewarePipelines Middleware pipelines
   */
  registerMiddlewarePipelines (middlewarePipelines: AccountMiddlewarePipelines): void,
  /**
   * Send an ILP prepare to the account entity
   * @param packet An ILP prepare packet
   */
  sendIlpPacket: IlpPacketHander,
  /**
   * Send an ILP prepare to the account entity
   * @param packet An ILP prepare packet
   */

  /**
   * Is the account entity connected
   */
  isConnected (): boolean,
}
