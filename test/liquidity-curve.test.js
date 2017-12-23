'use strict'

const assert = require('assert')
const LiquidityCurve = require('../src/routing/liquidity-curve')

describe('LiquidityCurve', function () {
  describe('constructor', function () {
    it('saves the points', function () {
      const points = [ [1, 2], [3, 4] ]
      const curve = new LiquidityCurve(points)
      assert.deepEqual(curve.getPoints(), points)
    })

    /* eslint-disable no-unused-vars */
    it('throws InvalidLiquidityCurveError if a point has a negative x-coordinate', function () {
      assert.throws(() => {
        const curve = new LiquidityCurve([ [-1, 5], [1, 5] ])
      }, /InvalidLiquidityCurveError: Cannot parse negative value: -1/)
    })

    it('throws InvalidLiquidityCurveError if a point has a negative y-coordinate', function () {
      assert.throws(() => {
        const curve = new LiquidityCurve([ [1, -5], [2, 5] ])
      }, /InvalidLiquidityCurveError: Cannot parse negative value: -5/)
    })

    it('throws InvalidLiquidityCurveError if the x-coordinates are not strictly increasing', function () {
      assert.throws(() => {
        const curve = new LiquidityCurve([ [1, 1], [3, 3], [3, 5] ])
      }, /InvalidLiquidityCurveError: Curve x-coordinates must strictly increase in series/)
    })

    it('throws InvalidLiquidityCurveError if the y-coordinates are not increasing', function () {
      assert.throws(() => {
        const curve = new LiquidityCurve([ [1, 1], [3, 3], [5, 2] ])
      }, /InvalidLiquidityCurveError: Curve y-coordinates must increase in series/)
    })

    it('throws an error if the buffer is an invalid length', function () {
      assert.throws(() => {
        const curve = new LiquidityCurve(Buffer.from([0]))
      }, /Invalid LiquidityCurve buffer/)
    })
    /* eslint-enable no-unused-vars */

    it('deserializes an empty buffer to an empty curve', function () {
      const curve = new LiquidityCurve(Buffer.from([]))
      assert.deepEqual(curve.getPoints(), [])
    })

    it('deserializes a curve buffer', function () {
      const points = [ [0, 0], [10, 20] ]
      const originalCurve = new LiquidityCurve(points)
      const curve = new LiquidityCurve(originalCurve.toBuffer())
      assert.deepEqual(curve.getPoints(), points)
    })

    it('deserializes a base64-encoded string', function () {
      const points = [ [0, 0], [10, 20] ]
      const originalCurve = new LiquidityCurve(points)
      const curve = new LiquidityCurve(originalCurve.toBuffer().toString('base64'))
      assert.deepEqual(curve.getPoints(), points)
    })
  })

  describe('getPoints', function () {
    it('returns the points', function () {
      const points = [ [1, 2], [3, 4] ]
      const curve = new LiquidityCurve(points)
      assert.deepEqual(curve.getPoints(), points)
    })
  })

  describe('amountAt', function () {
    const curve = new LiquidityCurve([[10, 20], [100, 200]])

    it('returns 0 if "x" is too low', function () {
      assert.equal(curve.amountAt(0), 0)
      assert.equal(curve.amountAt(5), 0)
    })

    it('returns the maximum if "x" is too high', function () {
      assert.equal(curve.amountAt(101), 200)
      assert.equal(curve.amountAt(1000), 200)
    })

    it('returns the linear interpolation of intermediate "x" values', function () {
      assert.equal(curve.amountAt(10), 20)
      assert.equal(curve.amountAt(11), 22)
      assert.equal(curve.amountAt(55), 110)
      assert.equal(curve.amountAt(100), 200)
    })

    it('returns an exact "y" value when possible', function () {
      const curve = new LiquidityCurve([[0, 0], [50, 100], [100, 1000]])
      assert.equal(curve.amountAt(50), 100)
    })
  })

  describe('amountReverse', function () {
    const curve = new LiquidityCurve([[10, 20], [100, 200]])

    it('returns the minimum "x" if "y" is too low', function () {
      assert.equal(curve.amountReverse(0), 10)
      assert.equal(curve.amountReverse(10), 10)
    })

    it('returns Infinity if "y" is too high', function () {
      assert.equal(curve.amountReverse(201).toNumber(), Infinity)
      assert.equal(curve.amountReverse(1000).toNumber(), Infinity)
    })

    it('returns the linear interpolation of intermediate "y" values', function () {
      assert.equal(curve.amountReverse(20), 10)
      assert.equal(curve.amountReverse(22), 11)
      assert.equal(curve.amountReverse(110), 55)
      assert.equal(curve.amountReverse(200), 100)
    })
  })

  describe('combine', function () {
    it('finds an intersection between a slope and a flat line', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [50, 60] ])
      const curve2 = new LiquidityCurve([ [0, 0], [100, 100] ])
      const combinedCurve = curve1.combine(curve2)

      assert.deepStrictEqual(combinedCurve.getPoints(),
        [ [0, 0], [50, 60], [60, 60], [100, 100] ])
      assert.equal(combinedCurve.amountAt(25), 30)
      assert.equal(combinedCurve.amountAt(50), 60)
      assert.equal(combinedCurve.amountAt(60), 60)
      assert.equal(combinedCurve.amountAt(70), 70)
    })

    it('doesn\'t generate duplicate points', function () {
      const curve1 = new LiquidityCurve([ [1, 0], [50000000001, 49800199999], [100000000000001, 49800199999] ])
      const curve2 = new LiquidityCurve([ [2, 0], [50000000001, 49800199999], [100000000000001, 49800199999] ])
      const combinedCurve = curve1.combine(curve2)
      assert.deepStrictEqual(combinedCurve.getPoints(),
        [ [1, 0], [2, 0], [50000000001, 49800199999], [100000000000001, 49800199999] ])
    })

    it('cleans up duplicate points caused by rounding', function () {
      const curve1 = new LiquidityCurve([ [0, 10], [10, 10], [20, 10] ])
      const curve2 = new LiquidityCurve([ [0, 0], [20, 21] ])
      const combinedCurve = curve1.combine(curve2)

      // Before rounding, the curve is:
      // [ [0,10], [9.52‥,10], [10,10], [20,21] ]
      assert.deepStrictEqual(combinedCurve.getPoints(),
        [ [0, 10], [10, 10], [20, 21] ])

      const curve3 = new LiquidityCurve([ [0, 1000000], [1000000, 1000000], [2000000, 1000000] ])
      const curve4 = new LiquidityCurve([ [0, 0], [2000000, 2000001] ])
      const combinedCurve2 = curve3.combine(curve4)
      // Before rounding, the curve is:
      // [ [0,0], [999999.50‥,1000000], [1000000,1000000], [2000000,2000001] ]
      assert.deepStrictEqual(combinedCurve2.getPoints(),
        [ [0, 1000000], [1000000, 1000000], [2000000, 2000001] ])
    })

    it('rounds x up and y down, to ensure the connector doesnt lose money', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [10, 9] ])
      const curve2 = new LiquidityCurve([ [1, 0], [10, 20] ])
      const combinedCurve = curve1.combine(curve2)
      // Before rounding, the curve is:
      // [ [0,0], [1,0], [1.6806722689075630252,1.51260504201680672268], [10,20] ]
      assert.deepStrictEqual(combinedCurve.getPoints(),
        [ [0, 0], [1, 0], [2, 1], [10, 20] ])
    })

    it('ignores an empty curve', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [50, 60] ])
      const curve2 = new LiquidityCurve([])
      assert.deepEqual(curve1.combine(curve2).getPoints(), [[0, 0], [50, 60]])
      assert.deepEqual(curve2.combine(curve1).getPoints(), [[0, 0], [50, 60]])
    })

    it('finds an intersection between two slopes', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [100, 1000] ])
      const curve2 = new LiquidityCurve([ [0, 0], [33, 450], [66, 550] ])
      const result = [
        [0, 0],
        [33, 450],
        [51, 502],
        [66, 660],
        [100, 1000]
      ]
      assert.deepEqual(curve1.combine(curve2).getPoints(), result)
      assert.deepEqual(curve2.combine(curve1).getPoints(), result)
    })

    it('misc tests', function () {
      const curve1 = new LiquidityCurve([[1711569, 1312840], [7503921, 6501735], [9033555, 9515658]])
      const curve2 = new LiquidityCurve([[7647566, 8125921], [8184218, 17986167], [9460351, 18838810]])
      const curve3 = new LiquidityCurve([[1302711, 4607848], [3449558, 6478308], [7395038, 9969362]])
      const curve4 = new LiquidityCurve([[16576, 8209992], [271695, 12268681], [9287990, 15228960]])
      assert.deepEqual(curve1.combine(curve2).getPoints(),
        [[1711569, 1312840], [7503921, 6501735], [7647566, 8125921], [8184218, 17986167], [9033555, 18553648], [9460351, 18838810]])
      assert.deepEqual(curve1.combine(curve3).getPoints(),
        [[1302711, 4607848], [1711569, 4964069], [3449558, 6478308], [7395038, 9969362], [7503921, 9969362], [9033555, 9969362]])
      assert.deepEqual(curve1.combine(curve4).getPoints(),
        [[16576, 8209992], [271695, 12268681], [1711569, 12741428], [7503921, 14643204], [9033555, 15145422], [9287990, 15228960]])
      assert.deepEqual(curve2.combine(curve3).getPoints(),
        [[1302711, 4607848], [3449558, 6478308], [7395038, 9969362], [7647566, 9969362], [7747897, 9969362], [8184218, 17986167], [9460351, 18838810]])
      assert.deepEqual(curve2.combine(curve4).getPoints(),
        [[16576, 8209992], [271695, 12268681], [7647566, 14690367], [8011342, 14809803], [8184218, 17986167], [9287990, 18723647], [9460351, 18838810]])
      assert.deepEqual(curve3.combine(curve4).getPoints(),
        [[16576, 8209992], [271695, 12268681], [1302711, 12607189], [3449558, 13312054], [7395038, 14607455], [9287990, 15228960]])
    })
  })

  describe('join', function () {
    it('composes two routes', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [200, 100] ])
      const curve2 = new LiquidityCurve([ [0, 0], [50, 60] ])
      const joinedCurve = curve1.join(curve2)

      assert.deepStrictEqual(joinedCurve.getPoints(),
        [ [0, 0], [100, 60] ])
      assert.equal(joinedCurve.amountAt(50), 30)
      assert.equal(joinedCurve.amountAt(100), 60)
      assert.equal(joinedCurve.amountAt(200), 60)
    })

    it('creates an empty curve if curve1 max output < curve2 min input', function () {
      const curve1 = new LiquidityCurve([ [1, 1], [100, 100] ])
      const curve2 = new LiquidityCurve([ [1000, 0], [1000000000, 100000] ])
      const joinedCurve = curve1.join(curve2)

      assert.deepStrictEqual(joinedCurve.getPoints(),
        [ ])
    })

    it('truncates the domain as necessary', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [50, 100] ])
      const curve2 = new LiquidityCurve([ [0, 0], [200, 300] ])
      const joinedCurve = curve1.join(curve2)
      assert.deepEqual(joinedCurve.getPoints(),
        [ [0, 0], [50, 150] ])
    })

    it('handles joining with a right-shifted curve', function () {
      const curve1 = new LiquidityCurve([ [0, 0], [10, 10] ])
      const curve2 = new LiquidityCurve([ [1, 1], [11, 11] ])
      const joinedCurve = curve1.join(curve2)
      assert.deepEqual(joinedCurve.getPoints(),
        [ [1, 1], [10, 10] ])
    })
  })

  describe('shiftX', function () {
    it('shifts all of the points\' Xs by the specified amount', function () {
      const curve = new LiquidityCurve([ [0, 0], [50, 60], [100, 100] ])
      assert.deepStrictEqual(curve.shiftX(1).getPoints(),
        [ [1, 0], [51, 60], [101, 100] ])
    })

    it('stays positive', function () {
      const curve = new LiquidityCurve([ [0, 0], [10, 10] ])
      assert.deepStrictEqual(curve.shiftX(-5).getPoints(),
        [ [0, 5], [5, 10] ])
    })

    it('shifts a single point and stays positive', function () {
      const curve = new LiquidityCurve([ [5, 5] ])
      assert.deepStrictEqual(curve.shiftX(-10).getPoints(),
        [ [0, 5] ])
    })
  })

  describe('shiftY', function () {
    it('shifts all of the points\' Ys by the specified amount', function () {
      const curve = new LiquidityCurve([ [0, 0], [50, 60], [100, 100] ])
      assert.deepStrictEqual(curve.shiftY(1).getPoints(),
        [ [0, 1], [50, 61], [100, 101] ])
    })

    it('stays positive', function () {
      const curve = new LiquidityCurve([ [0, 0], [10, 10] ])
      assert.deepStrictEqual(curve.shiftY(-5).getPoints(),
        [ [5, 0], [10, 5] ])
    })
  })

  describe('toBuffer', function () {
    it('serializes an empty curve', function () {
      const curve = new LiquidityCurve([])
      assert.deepEqual(curve.toBuffer(), Buffer.from([]))
    })

    it('serializes a curve', function () {
      const curve = new LiquidityCurve([ [0, 0], [10, 20] ])
      const buffer = curve.toBuffer()
      assert.equal(buffer.length, 32)
      assert.deepEqual(buffer.readUInt32LE(4), 0) // points[0][0]
      assert.deepEqual(buffer.readUInt32LE(12), 0) // points[0][1]
      assert.deepEqual(buffer.readUInt32LE(20), 10) // points[1][0]
      assert.deepEqual(buffer.readUInt32LE(28), 20) // points[1][1]
    })
  })
})
