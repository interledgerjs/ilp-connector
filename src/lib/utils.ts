import { createHash, randomBytes, createHmac } from 'crypto'
import { resolve } from 'path'
import { MiddlewareMethod } from '../types/middleware'

export const sha256 = (preimage: Buffer) => {
  return createHash('sha256').update(preimage).digest()
}

export function moduleExists (path: string) {
  try {
    require.resolve(path)
    return true
  } catch (err) {
    return false
  }
}

export const loadModuleFromPathOrDirectly = (searchPath: string, module: string) => {
  const localPath = resolve(searchPath, module)
  if (moduleExists(localPath)) {
    return localPath
  } else if (moduleExists(module)) {
    return module
  } else {
    return null
  }
}

export const loadModuleOfType = (type: string, name: string) => {
  const module = loadModuleFromPathOrDirectly(resolve(__dirname, `../${type}s/`), name)

  if (!module) {
    throw new Error(`${type} not found as a module name or under /${type}s/. moduleName=${name}`)
  }

  const loadedModule = require(module)

  if (loadedModule && typeof loadedModule === 'object' && typeof loadedModule.default === 'function') {
    // support ES6 modules
    return loadedModule.default
  } else if (typeof loadedModule === 'function') {
    return loadedModule
  } else {
    throw new TypeError(`${type} does not export a constructor. module=${module}`)
  }
}

export const extractDefaultsFromSchema = (schema: any, path = '') => {
  if (typeof schema.default !== 'undefined') {
    return schema.default
  }

  switch (schema.type) {
    case 'object':
      const result = {}
      for (let key of Object.keys(schema.properties)) {
        result[key] = extractDefaultsFromSchema(schema.properties[key], path + '.' + key)
      }
      return result
    default:
      throw new Error('No default found for schema path: ' + path)
  }
}

export function composeMiddleware<T, U> (
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

export function uuid () {
  const random = randomBytes(16)
  random[6] = (random[6] & 0x0f) | 0x40
  random[8] = (random[8] & 0x3f) | 0x80
  return random.toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
}

export function hmac (secret: Buffer, message: string | Buffer) {
  const hmac = createHmac('sha256', secret)
  if (message instanceof Buffer) {
    hmac.update(message)
  } else {
    hmac.update(message, 'utf8')
  }

  return hmac.digest()
}
