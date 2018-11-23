import reduct = require('reduct')

import { loadModuleOfType, composeMiddleware } from '../lib/utils'
import { create as createLogger } from '../common/log'
const log = createLogger('middleware-manager')

import Config from './config'
import Accounts from './accounts'
import Core from './core'
import Stats from './stats'
import {
  Middleware,
  MiddlewareDefinition,
  MiddlewareMethod,
  MiddlewareConstructor,
  Pipeline,
  Pipelines
} from '../types/middleware'
import MiddlewarePipeline from '../lib/middleware-pipeline'
import { Errors, IlpPrepare } from 'ilp-packet'
import { AccountService, IlpReply } from 'ilp-account-service'
const { codes, UnreachableError } = Errors

interface VoidHandler {
  (dummy: void): Promise<void>
}

const BUILTIN_MIDDLEWARES: { [key: string]: MiddlewareDefinition } = {
  errorHandler: {
    type: 'error-handler'
  },
  // rateLimit: {
  //   type: 'rate-limit'
  // },
  maxPacketAmount: {
    type: 'max-packet-amount'
  },
  // throughput: {
  //   type: 'throughput'
  // },
  // balance: {
  //   type: 'balance'
  // },
  deduplicate: {
    type: 'deduplicate'
  },
  expire: {
    type: 'expire'
  },
  validateFulfillment: {
    type: 'validate-fulfillment'
  },
  stats: {
    type: 'stats'
  },
  alert: {
    type: 'alert'
  }
}

export default class MiddlewareManager {
  protected config: Config
  protected accounts: Accounts
  protected core: Core
  protected middlewares: { [key: string]: Middleware }
  protected stats: Stats
  private startupHandlers: Map<string, VoidHandler> = new Map()
  private teardownHandlers: Map<string, VoidHandler> = new Map()
  private outgoingDataHandlers: Map<string, (param: IlpPrepare) => Promise<IlpReply>> = new Map()
  private started: boolean = false // TODO Manage per account?

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.core = deps(Core)
    this.stats = deps(Stats)

    const disabledMiddlewareConfig: string[] = this.config.disableMiddleware || []
    const customMiddlewareConfig: { [key: string]: MiddlewareDefinition } = this.config.middlewares || {}

    this.middlewares = {}

    for (const name of Object.keys(BUILTIN_MIDDLEWARES)) {
      if (disabledMiddlewareConfig.includes(name)) {
        continue
      }

      this.middlewares[name] = this.construct(name, BUILTIN_MIDDLEWARES[name])
    }

    for (const name of Object.keys(customMiddlewareConfig)) {
      if (this.middlewares[name]) {
        throw new Error('custom middleware has same name as built-in middleware. name=' + name)
      }

      this.middlewares[name] = this.construct(name, customMiddlewareConfig[name])
    }
  }

  construct (name: string, definition: MiddlewareDefinition): Middleware {
    // Custom middleware
    const Middleware: MiddlewareConstructor =
      loadModuleOfType('middleware', definition.type)

    return new Middleware(definition.options || {}, {
      getInfo: accountId => this.accounts.getInfo(accountId),
      getOwnAddress: () => this.accounts.getOwnAddress(),
      sendIlpPacket: this.sendIlpPacket.bind(this),
      stats: this.stats
    })
  }

  async setup () {
    for (const accountId of this.accounts.getAccountIds()) {
      await this.addAccountService(accountId, this.accounts.getAccountService(accountId))
    }
  }

  /**
   * Executes middleware hooks for connector startup.
   *
   * This should be called after the plugins are connected
   */
  async startup (accountId?: string) {
    if (accountId) {
      const handler = this.startupHandlers.get(accountId)
      if (handler) await handler(undefined)
    } else {
      this.started = true
      for (const handler of this.startupHandlers.values()) {
        await handler(undefined)
      }
    }
  }

  async addAccountService (accountId: string, accountService: AccountService) {
    const pipelines: Pipelines = {
      startup: new MiddlewarePipeline<void, void>(),
      teardown: new MiddlewarePipeline<void, void>(),
      incomingData: new MiddlewarePipeline<IlpPrepare, IlpReply>(),
      outgoingData: new MiddlewarePipeline<IlpPrepare, IlpReply>()
    }
    for (const middlewareName of Object.keys(this.middlewares)) {
      const middleware = this.middlewares[middlewareName]
      try {
        await middleware.applyToPipelines(pipelines, accountId)
      } catch (err) {
        const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : String(err)

        log.error('failed to apply middleware to account. middlewareName=%s accountId=%s error=%s', middlewareName, accountId, errInfo)
        throw new Error('failed to apply middleware. middlewareName=' + middlewareName)
      }
    }

    // Generate outgoing middleware
    const sendOutgoingIlpPacket = async (packet: IlpPrepare): Promise<IlpReply> => {
      try {
        return await accountService.sendIlpPacket(packet)
      } catch (e) {
        let err = e
        if (!err || typeof err !== 'object') {
          err = new Error('non-object thrown. value=' + e)
        }

        if (!err.ilpErrorCode) {
          err.ilpErrorCode = codes.F02_UNREACHABLE
        }

        err.message = 'failed to send packet: ' + err.message

        throw err
      }
    }

    const startupHandler = this.createHandler(pipelines.startup, accountId, async () => { return })
    const teardownHandler = this.createHandler(pipelines.teardown, accountId, async () => { return })
    const outgoingDataHandler: (param: IlpPrepare) => Promise<IlpReply> =
          this.createHandler(pipelines.outgoingData, accountId, sendOutgoingIlpPacket)

    this.startupHandlers.set(accountId, startupHandler)
    this.teardownHandlers.set(accountId, teardownHandler)
    this.outgoingDataHandlers.set(accountId, outgoingDataHandler)

    // Generate incoming middleware
    const handleIlpPacket: (param: IlpPrepare) => Promise<IlpReply> =
      (packet: IlpPrepare) => this.core.processIlpPacket(packet, accountId, this.sendIlpPacket.bind(this))
    const incomingIlpPacketHandler: (param: IlpPrepare) => Promise<IlpReply> =
      this.createHandler(pipelines.incomingData, accountId, handleIlpPacket)

    accountService.registerIlpPacketHandler(incomingIlpPacketHandler)
  }

  async removeAccountService (accountId: string) {
    this.accounts.getAccountService(accountId).deregisterIlpPacketHandler()

    this.startupHandlers.delete(accountId)
    const teardownHandler = this.teardownHandlers.get(accountId)
    if (teardownHandler) await teardownHandler(undefined)
    this.teardownHandlers.delete(accountId)
    this.outgoingDataHandlers.delete(accountId)
  }

  async sendIlpPacket (packet: IlpPrepare, accountId: string) {
    const handler = this.outgoingDataHandlers.get(accountId)

    if (!handler) {
      throw new UnreachableError('tried to send data to non-existent account. accountId=' + accountId)
    }

    return handler(packet)
  }

  getMiddleware (name: string): Middleware | undefined {
    return this.middlewares[name]
  }

  private createHandler<T, U> (pipeline: Pipeline<T, U>, accountId: string, next: (param: T) => Promise<U>): (param: T) => Promise<U> {
    const middleware: MiddlewareMethod<T, U> = composeMiddleware(pipeline.getMethods())

    return (param: T) => middleware(param, next)
  }
}
