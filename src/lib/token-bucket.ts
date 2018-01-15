export default class TokenBucket {
  private lastTime: number
  private left: number
  private capacity: number
  private refillRate: number

  constructor ({ refillPeriod, refillCount, capacity }: { refillPeriod: number, refillCount: number, capacity?: number }) {
    this.lastTime = Date.now()
    this.capacity = (typeof capacity !== 'undefined') ? capacity : refillCount
    this.left = this.capacity
    this.refillRate = refillCount / refillPeriod
  }

  take (count: number = 1) {
    const now = Date.now()
    const delta = Math.max(now - this.lastTime, 0)
    const amount = delta * this.refillRate

    this.lastTime = now
    this.left = Math.min(this.left + amount, this.capacity)

    // this debug statement is commented out for performance, uncomment when
    // debugging rate limit middleware
    //
    // log.debug('took token from bucket. accountId=%s remaining=%s', accountId, bucket.left)

    if (this.left < count) {
      return false
    }

    this.left -= count
    return true
  }
}
