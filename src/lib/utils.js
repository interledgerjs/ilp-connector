'use strict'

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

module.exports = {
  getPairs
}
