'use strict'

const crypto = require('crypto')

/**
 * Get all possible pair combinations from an array, order sensitive.
 *
 * Example:
 *   getPairs ([1, 2, 3, 4])
 *   => [ [ 1, 1 ], [ 1, 2 ], [ 2, 1 ], [ 1, 3 ], [ 3, 1 ], [ 1, 4 ], [ 4, 1 ],
 *        [ 2, 2 ], [ 2, 3 ], [ 3, 2 ], [ 2, 4 ], [ 4, 2 ],
 *        [ 3, 3 ], [ 3, 4 ], [ 4, 3 ],
 *        [ 4, 4 ] ]
 *
 * @param {array} arr Input array
 * @return {array[]} Possible pairs
 */
function getPairs (arr) {
  return arr.reduce((prev, cur, i) => {
    const combinations = arr.slice(i + 1).map(val => [[cur, val], [val, cur]])
    return prev.concat(Array.prototype.concat.apply([[cur, cur]], combinations))
  }, [])
}

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
 *
 * @param {PrefixMap} prefixMap Routing table
 * @param {string} address Destination address
 * @param {string} prefix Starting prefix
 * @return {string} Shortest prefix that will always use the same route as the
 *   one used for the given destination address.
 */
const getShortestUnambiguousPrefix = (prefixMap, address, prefix = '') => {
  if (!address.startsWith(prefix)) {
    throw new Error(`address must start with prefix. address=${address} prefix=${prefix}`)
  }

  prefixMap.keys().forEach(secondPrefix => {
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

const fulfillmentToCondition = (fulfillment) => {
  return crypto.createHash('sha256').update(fulfillment).digest()
}

module.exports = {
  getPairs,
  getShortestUnambiguousPrefix,
  fulfillmentToCondition
}
