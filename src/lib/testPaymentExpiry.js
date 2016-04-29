'use strict'
const _ = require('lodash')
const moment = require('moment')
const request = require('co-request')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')

module.exports = function * (config, payment) {
  const tester = new TransferTester(config, payment)
  yield tester.loadCaseExpiries()
  return tester
}

function TransferTester (config, payment) {
  this.config = config
  this.source_transfers = payment.source_transfers
  this.destination_transfers = payment.destination_transfers
  this.transfers = this.source_transfers.concat(this.destination_transfers)
  this.expiryByCase = {}

  // TODO use a more intelligent value for the minMessageWindow
  this.minMessageWindow = config.getIn(['expiry', 'minMessageWindow']) * 1000
  // TODO use a better value for the minExecutionWindow
  this.minExecutionWindow = this.minMessageWindow
  this.maxHoldTime = config.getIn(['expiry', 'maxHoldTime']) * 1000
}

TransferTester.prototype.getExpiry = function (transfer) {
  if (transfer.expires_at) return transfer.expires_at
  const expiries = _.uniq(_.values(_.pick(
    this.expiryByCase, getTransferCases(transfer))))
  if (expiries.length === 0) return undefined
  if (expiries.length === 1) return expiries[0]
  throw new UnacceptableExpiryError('Case expiries don\'t agree')
}

TransferTester.prototype.isAtomic = function () {
  return getTransferCases(this.source_transfers[0]).length > 0
}

// /////////////////////////////////////////////////////////////////////////////
// All
// /////////////////////////////////////////////////////////////////////////////

// Verify that none of the transfers have already expired
TransferTester.prototype.validateNotExpired = function () {
  this.source_transfers.forEach(this.validateTransferNotExpired, this)
  this.destination_transfers.forEach(this.validateTransferNotExpired, this)
}

TransferTester.prototype.validateTransferNotExpired = function (transfer) {
  const expiresAt = this.getExpiry(transfer)
  if (expiresAt && transfer.state !== 'executed' &&
    moment(expiresAt, moment.ISO_8601).isBefore(moment())) {
    throw new UnacceptableExpiryError('Transfer has already expired')
  }
}

// /////////////////////////////////////////////////////////////////////////////
// Non-Atomic
// /////////////////////////////////////////////////////////////////////////////

// If the destination transfer(s) have execution condition(s)
// we need to make sure we're not being asked
// to hold money for too long
TransferTester.prototype.validateMaxHoldTime = function () {
  for (const transfer of this.destination_transfers) {
    const expiresAt = this.getExpiry(transfer)
    if (expiresAt) {
      this.validateExpiryHoldTime(expiresAt)
    } else {
      throw new UnacceptableExpiryError('Destination transfers with ' +
        'execution conditions must have an expires_at field for connector ' +
        'to agree to authorize them')
    }
  }
}

TransferTester.prototype.validateExpiryHoldTime = function (expiresAt) {
  if (moment(expiresAt, moment.ISO_8601).diff(moment()) > this.maxHoldTime) {
    throw new UnacceptableExpiryError('Destination transfer expiry is ' +
      "too far in the future. The connector's money would need to be " +
      'held for too long')
  }
}

// We also need to check if we have enough time between the expiry
// of the destination transfer with the latest expiry and the expiry of
// the source transfer with the earliest expiry is greater than the
// minMessageWindow.
// This is done to ensure that we have enough time after the last
// moment one of the destination transfers could happen (taking money out
// of our account) to execute all of the source transfers
TransferTester.prototype.validateMinMessageWindow = function () {
  const earliestSourceTransferExpiry =
    _.min(_.map(this.source_transfers, function (transfer) {
      return (transfer.expires_at && transfer.state !== 'executed'
        ? moment(transfer.expires_at, moment.ISO_8601).valueOf()
        : Math.max())
    }))

  const latestDestinationTransferExpiry =
    _.max(_.map(this.destination_transfers, function (transfer) {
      return moment(transfer.expires_at, moment.ISO_8601).valueOf()
    }))

  if (earliestSourceTransferExpiry - latestDestinationTransferExpiry < this.minMessageWindow) {
    throw new UnacceptableExpiryError('The window between the latest ' +
      'destination transfer expiry and the earliest source transfer expiry ' +
      'is insufficient to ensure that we can execute the source transfers')
  }
}

// /////////////////////////////////////////////////////////////////////////////
// Atomic
// /////////////////////////////////////////////////////////////////////////////

TransferTester.prototype.loadCaseExpiries = function * () {
  for (const transfer of this.transfers) {
    if (transfer.expires_at) continue
    const caseIDs = getTransferCases(transfer)
    for (const caseID of caseIDs) {
      yield this.loadCaseExpiry(caseID)
    }
  }
}

// TODO check if the notary is trusted
TransferTester.prototype.loadCaseExpiry = function * (caseID) {
  if (this.expiryByCase[caseID]) return

  const caseRes = yield request({
    method: 'get',
    uri: caseID,
    json: true
  })
  if (caseRes.statusCode !== 200) {
    throw new UnacceptableExpiryError('Unexpected remote error: ' + caseRes.statusCode + ' ' + caseRes.body)
  }
  const expiry = caseRes.body.expires_at
  if (expiry) {
    this.expiryByCase[caseID] = expiry
  } else {
    throw new UnacceptableExpiryError('Cases must have an expiry.')
  }
}

function getTransferCases (transfer) {
  return (transfer.additional_info || {}).cases || []
}
