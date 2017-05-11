'use strict';

const _ = require('lodash')

module.exports = class FBME {
  constructor() {
    this.version = 1.0

    const envVarStr = process.env.CONNECTOR_FBME_LEDGER_MAPPING

    this.fbmeLedgerMap = JSON.parse(envVarStr)

    this.MsgType = { 
      Clock: 'C',
      BookUpdate: 'B',
      TopOfBook: 'b',
      Trade: 'T',
      LimitOrder: 'L',
      ExchangeInfo: 'I',
      CurrencyPair: 'p',
      Logon: 'n',
      OrderBookSnapshotRequest: 's',
      OrderBookSnapshotComplete: 'c',
      Payment: 'P',
      AccountUpdate: 'A',
      Balance: 'm',
      BalanceChange: 'e',
      QueryTraderBalance: 'q',
      QueryNextValidOrderID: 'O',
      QueryNextValidPaymentID: 'z'
    }

    this.AckLevel = {
      None: '7',
      SOFT_writtenToRAM: 'r',
      SOFT_writtenToDisk: 'd',
      HARD_writtenToAllMirrors: 'm'
    }

    this.PersistOrderFlag = {
      None: '7',
      Disable: 'd',
      Enable: 'e'
    }

    this.OrderStatus = {
      None: 'z',
      Submitted: '0',
      PartialFill: '1',
      Filled: '2',
      Cancelled: '3',
      Modified: '5',
      PendingCancel: '6',
      Rejected: '8',
      PendingSubmit: 'A',
      Validated: 'e',
      PendingModify: 'j',
      Rejected_TraderIDNotLoggedIn: 'l',
      Rejected_TraderIDOrderFromInvalidPort: 'm',
      Rejected_TraderInsufficentFunds: 'n',
      Rejected_IncorrectPriceSpecified: 'o',
      Rejected_IncorrectTickSizeInPriceSpecified: 'p',
      Rejected_NoOrderFoundWithPriceSpecified: 'q',
      Rejected_OrderIDNotFound: 'r',
      Rejected_UniqueOrderIDNotFound: 's',
      Rejected_OrderIDNotMonotonicAndNotAsExpected: 't',
      Rejected_TraderIDInvalid: 'u',
      Rejected_TraderIDSuspended: 'v',
      Rejected_CurrencyPairIDInvalid: 'x',
      CancelRejected_UniqueOrderIDNotBelongingToTraderID: 'y'
    }

    this.Action = {
      None: '7',
      Cancel: 'F',
      Modify: 'G',
      Transmit: 'D'
    }

    this.Side = {
      BUY: '1',
      SELL: '2'
    }

    this.PaymentEligible = {
      True: 't',
      False: 'f'
    }

    this.OrderHeld = {
      True: 't',
      False: 'f'
    }

    this.FIX = {
      FIXversion: 'FIX.4.4',
      delim: '|',
      endOfMessage: ' ',
      beginString: '8',
      MessageType: '35',
      Action: '20006',
      Side: '54',
      Account: '1',
      ClOrdID: '11',
      OrderID: '37',
      Price: '44',
      AvgPx: '6',
      LeavesQty: '151',
      CumQty: '14',
      OrdStatus: '39',
      CurrencyPairID: '48',
      LastModifiedTime: '779',
      BidPx: '132',
      BidSize: '134',
      OfferPx: '133',
      OfferSize: '135',
      LastPx: '31',
      LastQty: '32',
      // User custom defined tags are reserved for above 20000
      AckLevel: '20000',
      LastFillTime: '20001',
      TotalFillCost: '20002',
      PaymentEligible: '20003',
      IsHeld: '20004',
      IsPersistent: '20005',
      CurrencyID: '20007',
      Fiat: '20008',
      Issuer: '20009',
      Amount: '20010',
      CurrencyPairStr: '20011',
      DepthNum: '20012'
    }

    this.currencyPairStrToID = {}
    this.currencyPairIDToStr = {}
    this.currencyPairIDToSrcDstPair = {}
    this.currencypairIDs = {}
    this.bids = {}
    this.asks = {}
    this.traderBalances_ = {}

    this.nextvalidClientissuedorderID = -1
  }

  log(x) {
    console.log(x)
  }

  ledgerMaps() {
    return this.fbmeLedgerMap
  }

  // TODO ADD COMMENTS
  limitOrderToFIX (limitorder) {
    return this.FIX.beginString + '=' + this.FIX.FIXversion + this.FIX.delim +
      this.FIX.MessageType + '=' + limitorder.action + this.FIX.delim +
      this.FIX.Side + '=' + limitorder.side + this.FIX.delim +
      this.FIX.Price + '=' + limitorder.price + this.FIX.delim +
      this.FIX.LeavesQty + '=' + limitorder.leavesQty + this.FIX.delim +
      this.FIX.CurrencyPairID + '=' + limitorder.currencypairID + this.FIX.delim + this.FIX.ClOrdID + '=' + limitorder.clientissuedorderID
  }

  // PARSE FIX String
  parseFIX (str) {
    const dict = {}
    const parts = str.split('|')

    // PARSES X=Y|A=B etc
    parts.forEach( part => { 
      if (part.includes('=')) {
        const vals = part.split('=')
        dict[ vals[0] ] = vals[1]
      }
    })

    return dict
  }

  /**
   Parse incoming FIX string
   * @param {String} FIX Logon string 
   * @returns {Object} a Logon object
   */
  parseFIXOnLogon (logonFIXString) { 
    const dict = this.parseFIX(logonFIXString)
    return {
      MsgType: 'Logon',
      FIXversion: dict[this.FIX.beginString],
      nextvalid_clientissuedorderID: dict[this.FIX.ClOrdID]
    }
  }

  /**
   Parse incoming FIX string
   * @param {String} FIX LimitOrder string 
   * @returns {Object} a LimitOrder object
   */
  parseFIXLimitOrder (limitorderFIXString) {
    const dict = parseFIX(limitorderFIXString)
    return {
      msgType: 'LimitOrder',
      action: _.findKey(this.Action, dict[this.FIX.Action]),
      side: _.findKey(this.Side, this.FIX.Side),
      price: dict[this.FIX.Price],
      leavesQty: dict[this.FIX.LeavesQty],
      orderstatus: _.findKey(this.OrderStatus, this.FIX.OrdStatus),
      clientissued_orderID: dict[this.FIX.ClOrdID]
    }
  }

  /**
   Parse incoming FIX string
   * @param {String} FIX Balance string 
   * @returns {Object} a Balance object
   */
  parseFIXBalance (balanceFIXString) {
    const dict = this.parseFIX(balanceFIXString)
    return {
      msgType: 'Balance',
      amount: dict[this.FIX.Amount],
      currencyID: dict[this.FIX.CurrencyID],
      fiatStr: dict[this.FIX.Fiat],
      issuerStr: dict[this.FIX.Issuer]
    }
  }

  /**
   Parse incoming FIX string
   * @param {String, String} Currency strings
   * @returns {Integer} Currencypair unique identifier
   */
  getCurrencyPairID (sourceStr, destinationStr) {
    return this.currencyPairStrToID[ sourceStr + '/' + destinationStr ]
  }

  parseFIXCurrencyPair (currencyPairInput) {
    const dict = this.parseFIX(currencyPairInput)
    const currencypair = {
      msgType: 'CurrencyPair',
      currencypairID: dict[this.FIX.CurrencyPairID],
      currencypairStr: dict[this.FIX.CurrencyPairStr].trim()
    }
    
    const id = parseInt(currencypair.currencypairID)
    this.currencypairIDs[ id ] = currencypair.currencypairStr
    this.currencyPairIDToStr[ id ] = currencypair.currencypairStr
    this.currencyPairStrToID[ currencypair.currencypairStr ] = id
    const parts = currencypair.currencypairStr.split('/')
    this.currencyPairIDToSrcDstPair[ id ] = [ parts[0], parts[1] ]

    return {
      msgType: 'CurrencyPair',
      currencypairID: dict[this.FIX.CurrencyPairID],
      currencypairStr: dict[this.FIX.CurrencyPairStr].trim()
    }
  }

  parseFIXTopOfBook (t) {
    const dict = parseFIX(t)
    return {
      MsgType: 'TopOfBook',
      depthnum: dict[this.FIX.DepthNum],
      bidPx: dict[this.FIX.BidPx].trim(),
      bidSize: dict[this.FIX.BidSize].trim(),
      offerPx: dict[this.FIX.OfferPx].trim(),
      offerSize: dict[this.FIX.OfferSize].trim()
    }
  }

  parseFIXClock (ClockFIXMsg) {
    const dict = parseFIX(ClockFIXMsg)
    return {
      MsgType: 'Clock',
      timestamp: dict[this.FIX.LastModifiedTime].trim()
    }
  }

  handleBalance (b) {
    this.traderBalances_[ b.currencyID ] = b.amount
  }

  handleLogon (l) {
    this.nextvalidClientissuedorderID = l.nextvalid_clientissuedorderID
    //sendLimitOrderTestBatch()
  }

  handleTopOfBook (t) {
    bids[t.currencyPairID] = bids[t.currencyPairID] || {}
    asks[t.currencyPairID] = asks[t.currencyPairID] || {}

    bids[ t.currencypairID][ t.depthnum ] = [ t.bidPx, t.bidSize ]
    asks[ t.currencypairID ][ t.depthnum ] = [ t.offerPx, t.offerSize ]
  }

  // Return liquidity curve for currencypair P
  getCurve (sourceStr, destinationStr) {
    const currencypairID = getCurrencyPairID(sourceStr, destinationStr)
    const curve = {}
    curve.bids= []
    curve.asks = []
    curve.currencypairID = p
    curve.CurrencyPairStr = this.currencypairIDs[p]
    let srcSum = 0
    let dstSum = 0
    log(bids)
    log(asks)
    const priceIndex = 0
    const sizeIndex = 1
    let price, size
    
    bids[currencypairID].forEach( pricelevel => {  
      price = pricelevel[priceIndex]
      size =  pricelevel[sizeIndex]
      srcSum += Number(size)
      dstSum += Number(size) * Number(price)
      curve.bids.push([srcSum, dstSum])
    })
    srcSum = 0
    dstSum = 0
    asks[currencypairID].forEach( pricelevel => {  
      price = pricelevel[priceIndex]
      size =  pricelevel[sizeIndex]
      srcSum += Number(size)
      dstSum += Number(size) * Number(price)
      curve.asks.push([srcSum, dstSum])
    })
    return curve
  }

  handleFIX (s) {
    let str = s.toString()
    if (!str.includes('FIX.4.4')) {
      log('Invalid FIX format ' + str)
        return
    }

    if (str.includes(this.FIX.MessageType + '=' + this.MsgType.Logon)) {
      let k = this.parseFIXOnLogon(str)
      this.handleLogon(k)
    } else if (str.includes(this.FIX.MessageType + '=' + this.MsgType.LimitOrder)) {
      this.parseFIXLimitOrder(str)
      // log(l)
    } else if (str.includes(this.FIX.MessageType + '=' + this.MsgType.Balance)) {
      let b = this.parseFIXBalance(str)
      this.handleBalance(b)
    } else if (str.includes(this.FIX.MessageType + '=' + this.MsgType.CurrencyPair)) {
      this.parseFIXCurrencyPair(str)
      // log(c)
    } else if (str.includes(this.FIX.MessageType + '=' + this.MsgType.TopOfBook)) {
      let t = parseFIXTopOfBook(str)
      this.handleTopOfBook(t)
      //let parts = currencyPairIDToSrcDstPair[ t['currencypairID'] ]
      // log(getCurve(parts[0], parts[1]))
    } else if (str.includes(this.FIX.MessageType + '=' + this.MsgType.Clock)) {
      // log(parseFIXClock(str))
    }
  }

  getContent (url) {
    // return new pending promise
    return new Promise((resolve, reject) => {
      // select http or https module, depending on reqested url
      const lib = url.startsWith('https') ? require('https') : require('http')
      const request = lib.get(url, (response) => {
        // handle http errors
        if (response.statusCode < 200 || response.statusCode > 299) {
          reject(new Error('Failed to load page, status code: ' + response.statusCode))
        }
        // temporary data holder
        const body = []
        // on every content chunk, push it to the data array
        response.on('data', (chunk) => body.push(chunk))
        // we are done, resolve promise with those joined chunks
        response.on('end', () => resolve(body.join('')))
      })
      // handle connection errors of the request
      request.on('error', reject)
    })
  }

  buildOrderbookURL (endpointurl, currencypair) {
    if (endpointurl.includes('bitstamp')) {
      return 'https://www.bitstamp.net/api/v2/order_book/' + currencypair + '/'
    } 
    if (endpointurl.includes('bitso')) {
      return 'https://api.bitso.com/v2/order_book?book=' + currencypair
    } 
    if (endpointurl.includes('itbit')) {
      return 'https://api.itbit.com/v1/markets/' + currencypair + '/order_book'
    } 
    if (endpointurl.includes('mybitx')) {
      return 'https://api.mybitx.com/api/1/orderbook?pair=' + currencypair
    }
    
    log('Error : URL not supported : ' + endpointurl)
  }

  async getOrderbook ( url_input, pair_input ) {
    const url = this.buildOrderbookURL(url_input, pair_input)
    const orderbook = JSON.parse(await this.getContent(url))
    orderbook.url = url
    return orderbook
  }

}

