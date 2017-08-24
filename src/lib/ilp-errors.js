'use strict'

// ILP Error Codes (see RFC-0003 for more details).
const errors = {
  F00_Bad_Request: {code: 'F00', name: 'Bad Request'},
  F01_Invalid_Packet: {code: 'F01', name: 'Invalid Packet'},
  F02_Unreachable: {code: 'F02', name: 'Unreachable'},
  F03_Invalid_Amount: {code: 'F03', name: 'Invalid Amount'},
  F04_Insufficient_Destination_Amount: {code: 'F04', name: 'Insufficient Destination Amount'},
  F05_Wrong_Condition: {code: 'F05', name: 'Wrong Condition'},
  F06_Unexpected_Payment: {code: 'F06', name: 'Unexpected Payment'},
  F07_Cannot_Receive: {code: 'F07', name: 'Cannot Receive'},
  F99_Application_Error: {code: 'F99', name: 'Application Error'},

  T00_Internal_Error: {code: 'T00', name: 'Internal Error'},
  T01_Ledger_Unreachable: {code: 'T01', name: 'Ledger Unreachable'},
  T02_Ledger_Busy: {code: 'T02', name: 'Ledger Busy'},
  T03_Connector_Busy: {code: 'T03', name: 'Connector Busy'},
  T04_Insufficient_Liquidity: {code: 'T04', name: 'Insufficient Liquidity'},
  T05_Rate_Limited: {code: 'T05', name: 'Rate Limited'},
  T99_Application_Error: {code: 'T99', name: 'Application Error'},

  R00_Transfer_Timed_Out: {code: 'R00', name: 'Transfer Timed Out'},
  R01_Insufficient_Source_Amount: {code: 'R01', name: 'Insufficient Source Amount'},
  R02_Insufficient_Timeout: {code: 'R02', name: 'Insufficient Timeout'},
  R99_Application_Error: {code: 'R99', name: 'Application Error'}
}

function makeError (base, extra) {
  return Object.assign({}, base, extra)
}

for (const key in errors) {
  exports[key] = makeError.bind(null, errors[key])
}
