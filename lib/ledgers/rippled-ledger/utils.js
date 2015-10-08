'use strict'

exports.setTransferState = function (transfer, state) {
  transfer.state = state
  transfer.timeline = transfer.timeline || {}
  transfer.timeline[state + '_at'] = (new Date()).toISOString()
}
