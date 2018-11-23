import { AccountInfo } from './accounts'
import Stats from '../services/stats'
import { IlpPacket, IlpPrepare } from 'ilp-packet'
import { IlpReply } from 'ilp-account-service'

export interface MiddlewareDefinition {
  type: string,
  options?: object
}

/**
 * Services the connector exposes to middleware.
 */
export interface MiddlewareServices {
  stats: Stats
  getInfo (accountId: string): AccountInfo
  getOwnAddress (): string
  sendIlpPacket (data: IlpPacket, accountId: string): Promise<IlpPacket>
}

export interface MiddlewareCallback<T, U> {
  (val: T): Promise<U>
}

export interface MiddlewareMethod<T, U> {
  (val: T, next: MiddlewareCallback<T, U>): Promise<U>
}

export interface MiddlewareMethods {
  data: MiddlewareMethod<IlpPacket, IlpPacket>
}

export interface PipelineEntry<T, U> {
  name: string,
  method: MiddlewareMethod<T, U>
}

export interface Pipeline<T, U> {
  insertFirst (entry: PipelineEntry<T, U>): void
  insertLast (entry: PipelineEntry<T, U>): void
  insertBefore (middlewareName: string, entry: PipelineEntry<T, U>): void
  insertAfter (middlewareName: string, entry: PipelineEntry<T, U>): void
  getMethods (): MiddlewareMethod<T, U>[]
}

export interface Pipelines {
  readonly startup: Pipeline<void, void>,
  readonly teardown: Pipeline<void, void>,
  readonly incomingData: Pipeline<IlpPrepare, IlpReply>,
  readonly outgoingData: Pipeline<IlpPrepare, IlpReply>
}

export interface Middleware {
  applyToPipelines: (pipelines: Pipelines, accountId: string) => Promise<void>
}

export interface MiddlewareConstructor {
  new(options: object, api: MiddlewareServices): Middleware
}
