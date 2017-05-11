// index.js
'use strict';

var FBME = require('./fbme.js');

function log(x) { console.log(x) }

function assert(x,y) { 
  if(x===y) {
    console.log("TEST PASS: ", x , '===', y);
  } else {
    console.log("TEST FAIL: ", x , '===', y);
  }
}

let fbme = new FBME();
log(fbme.ledgerMaps());
assert(fbme.MsgType.Clock,'C');
assert(fbme.FIX.DepthNum, '20012');

var limitorder = {}
limitorder['msgType'] = 'LimitOrder'
limitorder['action'] = fbme.Action.None
limitorder['side'] = fbme.Side.BUY
limitorder['price'] = 12.34
limitorder['leavesQty'] = 6666
limitorder['currencypairID'] = 2
limitorder['orderstatus'] = fbme.OrderStatus.Submitted
limitorder['clientissuedorderID'] = 4
limitorder['acklevel'] = fbme.AckLevel.SOFT_writtenToRAM
limitorder['orderheld'] = fbme.OrderHeld.False
limitorder['paymenteligible'] = fbme.PaymentEligible.True
limitorder['ispersistent'] = fbme.PersistOrderFlag.False

assert( '8=FIX.4.4|35=7|54=1|44=12.34|151=6666|48=2|11=4', fbme.limitOrderToFIX(limitorder) );

var FIXtestStr = fbme.limitOrderToFIX(limitorder)
var limitorderdict = fbme.parseFIX(FIXtestStr)
var FIXtestStr2 = fbme.limitOrderToFIX(limitorder)

assert( FIXtestStr, FIXtestStr2);
log( fbme.buildOrderbookURL('bitstamp','xrpusd') )
fbme.getOrderbook('bitstamp','xrpusd').then(log)

const zmq = require('zmq')
var sock = zmq.socket('pair')
var multicastsub = zmq.socket('sub')
sock.connect('tcp://localhost:36002')
multicastsub.connect('tcp://localhost:36000')
multicastsub.subscribe('')

const send = function (message) {
  sock.send(message)
}

multicastsub.on('message', function (message) {
  fbme.handleFIX(message)
})

sock.on('message', function (message) {
  log('<<< ' + message)
  fbme.handleFIX(message)
})

send('8=FIX.4.4|35=n')
