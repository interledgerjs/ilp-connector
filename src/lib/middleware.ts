import reduct = require('reduct')
import { loadModuleOfType } from './utils'
import Middleware,
{
  MiddlewareDefinition,
  MiddlewareMethod,
  MiddlewareConstructor,
  Pipeline,
  Pipelines, MiddlewareServices
} from '../types/middleware'
import MiddlewarePipeline from './middleware-pipeline'
import { IlpPrepare, IlpReply } from 'ilp-packet'
import Account from '../types/account'
import WrapperAccount from '../accounts/wrapper'
import Config from '../services/config'
import { stringify } from 'querystring';

const BUILTIN_MIDDLEWARES: { [key: string]: MiddlewareDefinition } = {
  errorHandler: {
    type: 'error-handler'
  },
  rateLimit: {
    type: 'rate-limit'
  },
  maxPacketAmount: {
    type: 'max-packet-amount'
  },
  throughput: {
    type: 'throughput'
  },
  balance: {
    type: 'balance'
  },
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

function getMiddlewareNames (config: Config): string[] {
  const middlewares: string[] = []
  const disabledMiddlewareConfig: string[] = config.disableMiddleware || []
  const customMiddlewareConfig: { [key: string]: MiddlewareDefinition } = config.middlewares || {}

  for (const name of Object.keys(BUILTIN_MIDDLEWARES)) {
    if (disabledMiddlewareConfig.includes(name)) {
      continue
    }
    middlewares.push(name)
  }

  for (const name of Object.keys(customMiddlewareConfig)) {
    if (middlewares.includes(name)) {
      throw new Error('custom middleware has same name as built-in middleware. name=' + name)
    }
    middlewares.push(name)
  }
  return middlewares
}

export function constructMiddlewares (deps: reduct.Injector): { [key: string]: Middleware } {
  const config = deps(Config)
  const names = getMiddlewareNames(config)
  const middlewares = {} as { [key: string]: Middleware }
  names.map((name) => {
    middlewares[name] = constructMiddleware(name, BUILTIN_MIDDLEWARES[name], deps)
  })
  return middlewares
}

function composeMiddleware<T, U> (
  middleware: MiddlewareMethod<T, U>[]
): MiddlewareMethod<T, U> {
  return function (val: T, next: MiddlewareMethod<T, U>) {
    // last called middleware #
    let index = -1
    return dispatch(0, val)
    async function dispatch (i: number, val: T): Promise<U> {
      if (i <= index) {
        throw new Error('next() called multiple times.')
      }
      index = i
      const fn = (i === middleware.length) ? next : middleware[i]
      return fn(val, function next (val: T) {
        return dispatch(i + 1, val)
      })
    }
  }
}

function constructMiddleware (name: string, definition: MiddlewareDefinition, deps: reduct.Injector): Middleware {
  // Custom middleware
  const Middleware: MiddlewareConstructor =
    loadModuleOfType('middleware', definition.type)

  return new Middleware(definition.options || {}, deps)
}

export function constructMiddlewarePipeline<T,U> (pipeline: Pipeline<T,U>, endHandler: (param: T) => Promise<U>): (param: T) => Promise<U> {
  const middleware: MiddlewareMethod<T,U> = composeMiddleware(pipeline.getMethods())
  return (param: T) => middleware(param, endHandler)
}

export async function constructAccountPipelines (account: Account, middlewares: { [key: string]: Middleware }): Promise<Pipelines> {
  const pipelines: Pipelines = {
    startup: new MiddlewarePipeline<void, void>(),
    incomingData: new MiddlewarePipeline<IlpPrepare, IlpReply>(),
    incomingMoney: new MiddlewarePipeline<string, void>(),
    outgoingData: new MiddlewarePipeline<IlpPrepare, IlpReply>(),
    outgoingMoney: new MiddlewarePipeline<string, void>(),
    shutdown: new MiddlewarePipeline<void, void>()
  }
  for (const middlewareName of Object.keys(middlewares)) {
    const middleware = middlewares[middlewareName]
    try {
      await middleware.applyToPipelines(pipelines, account)
    } catch (err) {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : String(err)

      console.log('failed to apply middleware middlewareName=%s error=%s', middlewareName, errInfo)
      throw new Error('failed to apply middleware. middlewareName=' + middlewareName)
    }
  }

  return pipelines

}
