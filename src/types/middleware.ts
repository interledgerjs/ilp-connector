import { AccountInfo } from './accounts'
import { IlpPacket, IlpReply, IlpPrepare } from 'ilp-packet'
import Stats from '../services/stats'

export interface MiddlewareDefinition {
  type: string,
  options?: object
}

export interface MiddlewareServices {
  stats: Stats,
  getInfo (accountId: string): AccountInfo
  getOwnAddress (): string
  sendMoney (amount: string): Promise<void>
}

export interface MiddlewareCallback<T,U> {
  (val: T): Promise<U>
}

export interface MiddlewareMethod<T,U> {
  (val: T, next: MiddlewareCallback<T,U>): Promise<U>
}

export interface MiddlewareMethods {
  data: MiddlewareMethod<IlpPacket, IlpPacket>
  money: MiddlewareMethod<string, void>
}

export interface PipelineEntry<T,U> {
  name: string,
  method: MiddlewareMethod<T,U>
}

export interface Pipeline<T,U> {
  insertFirst (entry: PipelineEntry<T,U>): void
  insertLast (entry: PipelineEntry<T,U>): void
  insertBefore (middlewareName: string, entry: PipelineEntry<T,U>): void
  insertAfter (middlewareName: string, entry: PipelineEntry<T,U>): void
  getMethods (): MiddlewareMethod<T,U>[]
}

export interface Pipelines {
  readonly startup: Pipeline<void, void>,
  readonly incomingData: Pipeline<IlpPrepare, IlpReply>,
  readonly incomingMoney: Pipeline<string, void>,
  readonly outgoingData: Pipeline<IlpPrepare, IlpReply>
  readonly outgoingMoney: Pipeline<string, void>
  readonly shutdown: Pipeline<void, void>
}

export interface Middleware {
  applyToPipelines: (pipelines: Pipelines, accountId: string) => Promise<void>
}

export interface MiddlewareConstructor {
  new (options: object, api: MiddlewareServices): Middleware
}
