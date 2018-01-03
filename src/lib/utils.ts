import { createHash } from 'crypto'
import { resolve } from 'path'
import PrefixMap from '../routing/prefix-map'

/**
 * Find the shortest unambiguous prefix of an ILP address in a prefix map.
 *
 * This let's us figure out what addresses the selected route applies to. For
 * example, the most specific route for destination "a.b.c" might be "a", but
 * that doesn't mean that that route applies to any destination starting with
 * "a" because there may be a more specific route like "a.c".
 *
 * So we would call this utility function to find out that the least specific
 * prefix for which there are no other more specific routes is "a.b".
 *
 * In order to force a minimum prefix, it can be passed as the third parameter.
 * This function may make it even more specific if necessary to make it
 * unambiguous, but it will never return a less specific prefix.
 */
export const getShortestUnambiguousPrefix = <T> (prefixMap: PrefixMap<T>, address: string, prefix = '') => {
  if (!address.startsWith(prefix)) {
    throw new Error(`address must start with prefix. address=${address} prefix=${prefix}`)
  }

  prefixMap.keys().forEach((secondPrefix: string) => {
    if (secondPrefix === prefix) {
      return
    }

    while (secondPrefix.startsWith(prefix)) {
      if (secondPrefix === prefix) {
        return
      }

      const nextSegmentEnd = address.indexOf('.', prefix.length + 1)

      if (nextSegmentEnd === -1) {
        prefix = address
        return false
      } else {
        prefix = address.slice(0, nextSegmentEnd)
      }
    }
  })

  return prefix
}

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
