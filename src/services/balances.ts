import reduct = require('reduct')

export default class Balances {
  protected balances: Map<string, string>

  constructor (deps: reduct.Injector) {
    this.balances = new Map()
  }

  handleMoney (accountId: string, amount: string) {
    // TODO: Implement balance logic
  }
}
