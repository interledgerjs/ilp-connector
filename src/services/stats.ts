export default class Stats {
  private counters: { [k: string]: number } = {}
  private meters: { [k: string]: number } = {}

  meter (key: string) {
    this.meters[key] = (this.meters[key] || 0) + 1
  }

  counter (key: string, value: number) {
    this.counters[key] = (this.counters[key] || 0) + value
    this.meter(key)
  }

  getStatus () {
    return {
      counters: this.counters,
      meters: this.meters
    }
  }
}
