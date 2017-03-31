// index.js
'use strict';

var co = require('co');
var FBME = require('./index.js');

function log(x) { console.log(x) }

function assert(x,y) { 
  if(x===y) {
    console.log("TEST PASS: ", x , '===', y);
  } else {
    console.log("TEST FAIL: ", x , '===', y);
  }
}

const opts = {backendUri: 'tcp://216.253.226.68'}
let fbme = new FBME(opts);
assert(fbme.MsgType.Clock,'C');
assert(fbme.FIX.DepthNum, '20012');

let fbme2 = new FBME(opts);
fbme2.currencyPairStrToID['a.b/c.d'] = 1
fbme2.bids[1] = {}
fbme2.asks[1] = {}
  
fbme2.bids[1] = [{price: 1.0, size: 1.0}, {price: 2.0, size: 2.0}]

fbme2.asks[1] = [{price: 0.75, size: 1.0}, {price:0.5, size : 1.0}]

let params = { 
  source_currency: 'a',
  source_ledger: 'b',
  destination_currency: 'c',
  destination_ledger: 'd'
}

let curve = co(fbme2.getCurve(params))
  .then(value => {
    log( 'TEST getCurve ' + value.points)
  })
  .catch(err => {
    console.error(err.stack);
  });


var limitorder = {
  msgType: 'LimitOrder',
  action: fbme.Action.Transmit,
  side: fbme.Side.BUY,
  price: 12.34,
  leavesQty: 6666,
  currencyPairID: 2,
  orderstatus: fbme.OrderStatus.Submitted,
  clientissuedorderID: 4,
  account: 1,
  acklevel: fbme.AckLevel.SOFT_writtenToRAM,
  orderheld: fbme.OrderHeld.False,
  paymenteligible: fbme.PaymentEligible.True,
  ispersistent: fbme.PersistOrderFlag.False
}

assert( '8=FIX.4.4|35=L|20006=D|1=1|54=1|44=12.34|151=6666|48=2|11=4', fbme._limitOrderToFIX(limitorder) );

var FIXtestStr = fbme._limitOrderToFIX(limitorder)
var limitorderdict = fbme._parseFIX(FIXtestStr)
var FIXtestStr2 = fbme._limitOrderToFIX(limitorder)

assert( FIXtestStr, FIXtestStr2);
log( fbme._buildOrderbookURL('bitstamp','xrpusd') )

var connectresult = co(fbme.connect()).then(function (value) {
}, function (err) {
    console.error(err.stack);
});

const send = function (message) {
  log('>>> ' + message)
  fbme.sock.send(message)
}

setTimeout(testbatch, 1000);

function testbatch () {
  log('ENTERED TESTBATCH')

    let params = { 
    source_currency: 'XRP',
    source_ledger: 'g.us.nexus',
    destination_currency: 'USD',
    destination_ledger: 'g.us.nexus'
  }

  let curve = co(fbme.getCurve(params))
    .then(value => {
      log( 'TEST getCurve ' + value.points)
    })
    .catch(err => {
      console.error(err.stack);
    });

  params = { 
    source_currency: 'USD',
    source_ledger: 'g.us.nexus',
    destination_currency: 'XRP',
    destination_ledger: 'g.us.nexus'
  }

  curve = co(fbme.getCurve(params)).then(function (value) {
    log( 'TEST getCurve ' + value.points)
  }, function (err) {
    console.error(err.stack);
  });

params = {
  source_currency: 'USD',
  source_ledger: 'g.us.nexus',
  destination_currency: 'XRP',
  destination_ledger: 'g.us.nexus',
  source_amount: '4',
  destination_amount: '2'
}

let payment = co(fbme.submitPayment(params)).then(function (result) {
}, function (err) {
console.error(err.stack);
});

}

