import { createHash } from 'crypto'
import { resolve } from 'path'
import PrefixMap from '../routing/prefix-map'

export const fulfillmentToCondition = (fulfillment: Buffer) => {
  return createHash('sha256').update(fulfillment).digest()
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
