import { IlpPrepare, IlpReply } from 'ilp-packet'

export type RequestHandler = (packet: IlpPrepare) => Promise<IlpReply>

export type RequestHandlerProvider = (packet: IlpPrepare) => RequestHandler

/**
 * A standardized interface for sending and receiving ILP packets.
 */
export interface IlpEndpoint {

  /**
   * A provider of handler(s) for incoming requests.
   */
  handlerProvider: RequestHandlerProvider

  /**
   * Send a Request and wait for the Reply.
   *
   * @param request ILP Prepare packet to send
   * @param sentCallback Callback invoked by the underlying stream when the message has been sent
   */
  request: (request: IlpPrepare, sentCallback?: () => void) => Promise<IlpReply>

  /**
   * EventEmitter interface methods for `error` events
   */
  addListener (event: 'error', listener: (err: Error) => void): this
  emit (event: 'error', err: Error): boolean
  on (event: 'error', listener: (err: Error) => void): this
  once (event: 'error', listener: (err: Error) => void): this
  prependListener (event: 'error', listener: (err: Error) => void): this
  prependOnceListener (event: 'error', listener: (err: Error) => void): this
  removeListener (event: 'error', listener: (err: Error) => void): this

}