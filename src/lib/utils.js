'use strict'

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

module.exports = {
  getPairs
}
