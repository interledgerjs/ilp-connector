import { AccountInfo } from './accounts'

export interface MiddlewareDefinition {
  type: string,
  options?: object
}

export interface MiddlewareStats {
  meter (key: string)
  counter (key: string, value: number)
}

/**
 * Services the connector exposes to middleware.
 */
export interface MiddlewareServices {
  stats: MiddlewareStats
  getInfo (accountId: string): AccountInfo
  getOwnAddress (): string
  sendData (data: Buffer, accountId: string): Promise<Buffer>
  sendMoney (amount: string, accountId: string): Promise<void>
}

export interface MiddlewareCallback<T,U> {
  (val: T): Promise<U>
}

export interface MiddlewareMethod<T,U> {
  (val: T, next: MiddlewareCallback<T,U>): Promise<U>
}

export interface MiddlewareMethods {
  data: MiddlewareMethod<Buffer, Buffer>
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
  readonly incomingData: Pipeline<Buffer, Buffer>,
  readonly incomingMoney: Pipeline<string, void>,
  readonly outgoingData: Pipeline<Buffer, Buffer>
  readonly outgoingMoney: Pipeline<string, void>
}

export interface Middleware {
  applyToPipelines: (pipelines: Pipelines, accountId: string) => Promise<void>
  getStatus?: () => { [s: string]: any }
}

export interface MiddlewareConstructor {
  new (options: object, api: MiddlewareServices): Middleware
}
