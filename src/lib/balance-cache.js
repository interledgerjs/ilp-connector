'use strict'
const request = require('co-request')
const BigNumber = require('bignumber.js')
const ExternalError = require('../errors/external-error')

function BalanceCache (config) {
  this.config = config
  this.balanceByLedger = {}
  this.timer = null
}

BalanceCache.prototype.get = function * (ledger) {
  return this.balanceByLedger[ledger] ||
        (this.balanceByLedger[ledger] = (yield this.load(ledger)))
}

BalanceCache.prototype.load = function * (ledger) {
  // TODO use ledger notifications to reload the cache instead
  // see: https://github.com/interledger/five-bells-ledger/issues/111
  clearInterval(this.timer)
  this.timer = setInterval(this.reset.bind(this), 60000).unref()

  const creds = this.config.ledgerCredentials[ledger]
  let res
  try {
    res = yield request({
      method: 'get',
      uri: creds.account_uri,
      auth: {
        user: creds.username,
        pass: creds.password
      },
      json: true
    })
  } catch (e) { }
  if (!res || res.statusCode !== 200) {
    throw new ExternalError('Unable to determine current balance')
  }
  return new BigNumber(res.body.balance)
}

// Used to clean up between tests.
BalanceCache.prototype.reset = function () {
  this.balanceByLedger = {}
}

module.exports = BalanceCache
