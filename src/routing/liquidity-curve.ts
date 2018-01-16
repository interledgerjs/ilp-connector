'use strict'

import Long = require('long')
import BigNumber from 'bignumber.js'

// Fix missing type declaration in bignumber.js
declare module 'bignumber.js' {
  export interface BigNumber {
    isBigNumber: true
  }
}

BigNumber.config({ DECIMAL_PLACES: 19 })

export type Point = [BigNumber, BigNumber]
export type LooselyTypedNumber = BigNumber | string | number
export type LooselyTypedPoint = [LooselyTypedNumber, LooselyTypedNumber]

export class InvalidLiquidityCurveError extends Error {
  constructor (message: string, points?: any) {
    if (points) {
      message = message + ' points:' + JSON.stringify(points)
    }
    super(message)
    this.name = 'InvalidLiquidityCurveError'
  }
}

// TODO use integer math
export default class LiquidityCurve {
  protected data: Buffer
  protected points: Point[]

  constructor (data: string | LooselyTypedPoint[] | Buffer) {
    if (typeof data === 'string') {
      this.setData(Buffer.from(data, 'base64'))
    } else if (data instanceof Array) { // Points
      this.setData(serializePoints(data))
    } else { // Buffer
      this.setData(data)
    }
  }

  setData (data: Buffer) {
    if (data.length % 16 !== 0) {
      throw new InvalidLiquidityCurveError('Invalid LiquidityCurve buffer')
    }
    this.data = data
    this.points = deserializePoints(data)
    let prev
    for (let i = 0; i < this.points.length; i++) {
      let point = this.points[i]
      if (prev && point[0].lessThanOrEqualTo(prev[0])) {
        throw new InvalidLiquidityCurveError('Curve x-coordinates must strictly increase in series', this.getPoints())
      }
      if (prev && point[1].lessThan(prev[1])) {
        throw new InvalidLiquidityCurveError('Curve y-coordinates must increase in series', this.getPoints())
      }
      prev = point
    }
  }

  amountAt (xVal: LooselyTypedNumber) {
    const x = bnFromValue(xVal)
    const firstPoint = this.points[0]
    const lastPoint = this.points[this.points.length - 1]
    if (x.lt(firstPoint[0])) return new BigNumber(0)
    if (x.eq(firstPoint[0])) return firstPoint[1]
    if (lastPoint[0].lte(x)) return lastPoint[1]

    let i; for (i = 0; this.points[i][0].lt(x); i++) ;

    const pointA = this.points[i - 1]
    const pointB = this.points[i]
    const dy = pointB[1].sub(pointA[1])
    const dx = pointB[0].sub(pointA[0])
    return dy.mul(x.sub(pointA[0])).div(dx)
      .add(pointA[1])
      .floor()
  }

  amountReverse (yVal: LooselyTypedNumber) {
    const y = bnFromValue(yVal)
    if (this.points[0][1].gte(y)) {
      return this.points[0][0]
    }
    if (this.points[this.points.length - 1][1].lt(y)) {
      return new BigNumber(Infinity)
    }

    let i; for (i = 0; this.points[i][1].lt(y); i++) ;

    const pointA = this.points[i - 1]
    const pointB = this.points[i]
    const dx = pointB[0].sub(pointA[0])
    const dy = pointB[1].sub(pointA[1])
    return dx.mul(y.sub(pointA[1])).div(dy)
      .add(pointA[0])
      .floor()
  }

  /**
   * Combine two parallel routes, generating a new curve consisting of the best
   * segments of each.
   *
   * @param {LiquidityCurve} curve
   * @returns {LiquidityCurve}
   */
  combine (curve: LiquidityCurve) {
    const combined = this._mapToMax(curve.points)
      .concat(curve._mapToMax(this.points))
      .concat(this._crossovers(curve))
      .sort(comparePoints)
      .map(roundCoords)
      .filter(omitDuplicates)

    // The following check is technically redundant, since LiquidityCurve#setPoints
    // will do the same, and more checks.
    // It's just included here for extra debug output, and can be removed later.

    let prevY = new BigNumber(0)
    for (let i = 0; i < combined.length; i++) {
      const nextY = new BigNumber(combined[i][1])
      if (nextY.lt(prevY)) {
        throw new InvalidLiquidityCurveError(`position ${i}: ${nextY} < ${prevY}`, {
          curve1: this.points,
          curve2: curve.points,
          combined
        })
      }
      prevY = combined[i][1]
    }
    return new LiquidityCurve(combined)
  }

  /**
   * A._mapToMax(B) to find [AB, A]
   * B._mapToMax(A) to find [AB, B]
   *
   * │              B
   * │    A a a a a a
   * │   a    b
   * │  a  b
   * │ AB
   * └────────────────
   */
  _mapToMax (points: Point[]) {
    if (this.points.length === 0) return points
    return points.map((point): Point => [
      point[0],
      max(point[1], this.amountAt(point[0]))
    ])
  }

  /**
   * A._crossovers(B) to find [AB, ●]
   *
   * │              B
   * │    A a a a●a a
   * │   a    b
   * │  a  b
   * │ AB
   * └────────────────
   */
  _crossovers (curve: LiquidityCurve) {
    if (this.points.length === 0 || curve.points.length === 0) return []
    let pointsA = this.points
    let pointsB = curve.points
    const endA = pointsA[pointsA.length - 1]
    const endB = pointsB[pointsB.length - 1]
    if (endA[0].lt(endB[0])) pointsA = pointsA.concat([ [endB[0], endA[1]] ])
    if (endB[0].lt(endA[0])) pointsB = pointsB.concat([ [endA[0], endB[1]] ])

    const result: Point[] = []
    this._eachOverlappingSegment(pointsA, pointsB, (pA1, pA2, pB1, pB2) => {
      const solution = intersectLineSegments(pA1, pA2, pB1, pB2)
      if (solution) result.push(solution)
    })
    return result
  }

  /**
   * @param {Point[]} pointsA
   * @param {Point[]} pointsB
   * @param {function(lineA, lineB)} each
   */
  _eachOverlappingSegment (pointsA: Point[], pointsB: Point[], each: (p1: Point, p2: Point, p3: Point, p4: Point) => void) {
    let cursor = 1
    for (let indexA = 1; indexA < pointsA.length; indexA++) {
      const p1 = pointsA[indexA - 1]
      const p2 = pointsA[indexA]
      for (let indexB = cursor; indexB < pointsB.length; indexB++) {
        const p3 = pointsB[indexB - 1]
        const p4 = pointsB[indexB]
        if (p4[0].lt(p1[0])) { cursor++; continue }
        if (p2[0].lt(p3[0])) break
        each(p1, p2, p3, p4)
      }
    }
  }

  /**
   * Compose two routes end-to-end: A→B.join(B→C) becomes A→C.
   * @param {LiquidityCurve} curve
   * @returns {LiquidityCurve}
   */
  join (curve: LiquidityCurve) {
    const leftPoints: Point[] = []
    const minX = curve.points[0][0]
    const maxX = curve.points[curve.points.length - 1][0]
    this.points.forEach((p) => {
      // If `p.y` is not within `curve`'s domain, don't use it to form the new curve.
      if (minX.lte(p[1]) && p[1].lte(maxX)) {
        leftPoints.push([ p[0], curve.amountAt(p[1]) ])
      }
    })

    return new LiquidityCurve(
      leftPoints
        .concat(curve.points
          .map((p): Point => [ this.amountReverse(p[0]), p[1] ])
        )
        .sort(comparePoints)
        .filter(omitInfinity)
        .filter(omitDuplicates)
    )
  }

  shiftX (_dx: number) {
    const dx = new BigNumber(_dx)
    let shiftedPoints = this.points.map((p): Point => [ p[0].add(dx), p[1] ])
    if (dx.gte(0)) return new LiquidityCurve(shiftedPoints)

    for (let i = shiftedPoints.length - 1; i >= 0; i--) {
      if (Number(shiftedPoints[i][0]) < 0) {
        shiftedPoints = shiftedPoints.slice(i + 1)
        shiftedPoints.unshift([new BigNumber(0), this.amountAt(dx.negated())])
        break
      }
    }
    return new LiquidityCurve(shiftedPoints)
  }

  shiftY (_dy: number) {
    const dy = new BigNumber(_dy)
    let shiftedPoints = this.points.map((p): Point => [ p[0], p[1].add(dy) ])
    if (dy.gte(0)) return new LiquidityCurve(shiftedPoints)

    for (let i = shiftedPoints.length - 1; i >= 0; i--) {
      if (shiftedPoints[i][1].isNegative()) {
        shiftedPoints = shiftedPoints.slice(i + 1)
        shiftedPoints.unshift([this.amountReverse(dy.negated()), new BigNumber(0)])
        break
      }
    }
    return new LiquidityCurve(shiftedPoints)
  }

  /**
   * This converts the points to a list of pairs of numbers.
   * It can lose precision, so it should only be used for testing/debugging.
   */
  getPoints () {
    return this.points.map((point) => [
      point[0].toNumber(),
      point[1].toNumber()
    ])
  }

  toBuffer () { return this.data }
}

function omitInfinity (point: Point) { return point[0].toString() !== 'Infinity' }
function comparePoints (a: Point, b: Point) { return a[0].comparedTo(b[0]) }
// Round to ensure the connector doesn't lose money.
function roundCoords (point: Point): Point { return [ point[0].ceil(), point[1].floor() ] }

function omitDuplicates (point: Point, i: number, points: Point[]) {
  return i === 0 || !point[0].eq(points[i - 1][0])
}

/**
 * Intersect two line segments using determinants. This is more precise than
 * intersecting the lines using slopes and y-intercepts -- fewer fractions.
 *
 * See: http://mathworld.wolfram.com/Line-LineIntersection.html
 */
function intersectLineSegments (p1: Point, p2: Point, p3: Point, p4: Point): Point | undefined {
  const denominator = determinant(
    p1[0].sub(p2[0]), p1[1].sub(p2[1]),
    p3[0].sub(p4[0]), p3[1].sub(p4[1]))
  const topLeft = determinant(
    p1[0], p1[1],
    p2[0], p2[1])
  const bottomLeft = determinant(
    p3[0], p3[1],
    p4[0], p4[1])

  // Parallel lines.
  if (denominator.isZero()) return undefined
  const x = determinant(
    topLeft, p1[0].sub(p2[0]),
    bottomLeft, p3[0].sub(p4[0])
  ).div(denominator)
  // Ensure that the intersection is within the line segments, not just the lines.
  if (x.lt(p1[0]) || p2[0].lt(x)) return undefined
  if (x.lt(p3[0]) || p4[0].lt(x)) return undefined
  const y = determinant(
    topLeft, p1[1].sub(p2[1]),
    bottomLeft, p3[1].sub(p4[1])
  ).div(denominator)
  if (y.lt(p1[1]) || p2[1].lt(y)) return undefined
  if (y.lt(p3[1]) || p4[1].lt(y)) return undefined
  return [x, y]
}

/**
 * │a  b│
 * │c  d│ = ad - bc
 */
function determinant (a: BigNumber, b: BigNumber, c: BigNumber, d: BigNumber) {
  return a.mul(d).sub(b.mul(c))
}

function max (long1: BigNumber, long2: BigNumber) {
  return long1.gt(long2) ? long1 : long2
}

function bnFromValue (rawValue: string | number | BigNumber) {
  let value = rawValue
  if (typeof value === 'number') {
    if (value < 0) {
      throw new InvalidLiquidityCurveError('Cannot parse negative value: ' + value)
    }
    value = Math.floor(value)
  } else if (typeof value === 'string') {
    if (value[0] === '-') {
      throw new InvalidLiquidityCurveError('Cannot parse negative value: ' + value)
    }
  } else if (typeof value === 'object') {
    if (value.isBigNumber && value.isNegative()) {
      throw new InvalidLiquidityCurveError('Cannot parse negative value: ' + value.toString())
    }
  } else {
    throw new InvalidLiquidityCurveError('Unknown type of value: ' + typeof value)
  }
  return new BigNumber(value)
}

function serializePoints (points: LooselyTypedPoint[]) {
  const buffer = Buffer.alloc(points.length * 16)
  let i = 0
  for (const point of points) {
    const x = Long.fromString(bnFromValue(point[0]).toFixed(0), true)
    const y = Long.fromString(bnFromValue(point[1]).toFixed(0), true)
    buffer.writeUInt32LE(x.getHighBitsUnsigned(), i)
    buffer.writeUInt32LE(x.getLowBitsUnsigned(), i + 4)
    buffer.writeUInt32LE(y.getHighBitsUnsigned(), i + 8)
    buffer.writeUInt32LE(y.getLowBitsUnsigned(), i + 12)
    i += 16
  }
  return buffer
}

function deserializePoints (buffer: Buffer) {
  let array
  if (buffer.byteOffset % 4 === 0) {
    // fast method - only possible when byteOffset is a multiple of 4
    array = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
  } else {
    // slow method - fallback
    array = new Uint32Array(buffer.length / 4)
    const arrBuffer = Buffer.from(array.buffer)
    buffer.copy(arrBuffer)
  }
  const points: Point[] = []
  for (let i = 0; i < array.length; i += 4) {
    const xHi = array[i]
    const xLo = array[i + 1]
    const yHi = array[i + 2]
    const yLo = array[i + 3]
    points.push([
      new BigNumber(new Long(xLo, xHi, true).toString()),
      new BigNumber(new Long(yLo, yHi, true).toString())
    ])
  }
  return points
}
