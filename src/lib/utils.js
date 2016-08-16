'use strict'

const crypto = require('crypto')

/**
 * Get all possible pair combinations from an array.
 *
 * Example:
 *   getPairs ([1, 2, 3, 4])
 *   // => [ [ 1, 2 ], [ 1, 3 ], [ 1, 4 ], [ 2, 3 ], [ 2, 4 ], [ 3, 4 ] ]
 *
 * @param {array} arr Input array
 * @return {array[]} Possible pairs
 */
function getPairs (arr) {
  return arr.reduce((prev, cur, i) => (
    prev.concat(arr.slice(i + 1).map((val) => [cur, val]))
  ), [])
}

/**
 * Deterministically generate a UUID from a secret and a public input.
 *
 * Uses HMAC-SHA-256 to generate a new UUID given a secret and a public input.
 *
 * The ID for the next transfer should be deterministically generated, so
 * that the connector doesn't send duplicate outgoing transfers if it
 * receives duplicate notifications.
 *
 * The deterministic generation should ideally be impossible for a third
 * party to predict. Otherwise an attacker might be able to squat on a
 * predicted ID in order to interfere with a payment or make a connector
 * look unreliable. In order to assure this, the connector may use a
 * secret that seeds the deterministic ID generation.
 *
 * @param {Buffer|String} secret Secret input
 * @param {String} input Public input
 * @returns {String} Deterministic output UUID
 */
function getDeterministicUuid (secret, input) {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(input)
  const hash = hmac.digest('hex').substring(0, 36)
  const chars = hash.split('')
  chars[8] = '-'
  chars[13] = '-'
  chars[14] = '4'
  chars[18] = '-'
  chars[19] = '8'
  chars[23] = '-'
  return chars.join('')
}

module.exports = {
  getPairs,
  getDeterministicUuid
}
