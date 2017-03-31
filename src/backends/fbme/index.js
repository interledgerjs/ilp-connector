'use strict';

const _ = require('lodash')
const BigNumber = require('bignumber.js')
const log = require('../../common').log.create('fbme')
const zmq = require('zeromq')
const ServerError = require('five-bells-shared/errors/server-error')

class FBMEBackend {
  /*
   * Default constructor
   * */
  constructor(opts) {
    if(!opts) {
      opts = {}
    }

    this.version = 1.0
    this.backendUri = opts.backendUri

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
    this.currencyPairIDs = {}
    this.bids = {}
    this.asks = {}
    this.traderBalances = {}

    this.nextvalidClientissuedorderID = -1
    this.sock = zmq.socket('pair')
    this.multicastsub = zmq.socket('sub')
  }

  /*
   * @input {Object} limitorder
   * @returns {String} FIX String which contains limitorder data
   */
  _limitOrderToFIX (limitorder) {
    return this.FIX.beginString + '=' + this.FIX.FIXversion + this.FIX.delim +
      this.FIX.MessageType + '=' + this.MsgType.LimitOrder + this.FIX.delim +
      this.FIX.Action + '=' + limitorder.action + this.FIX.delim +
      this.FIX.Account + '=' + limitorder.account + this.FIX.delim +
      this.FIX.Side + '=' + limitorder.side + this.FIX.delim +
      this.FIX.Price + '=' + limitorder.price + this.FIX.delim +
      this.FIX.LeavesQty + '=' + limitorder.leavesQty + this.FIX.delim +
      this.FIX.CurrencyPairID + '=' + limitorder.currencyPairID + this.FIX.delim + this.FIX.ClOrdID + '=' + limitorder.clientissuedorderID
  }

  /*
   * @input {String} 
   * @returns {Object}  returns parsed FIX string as a map
   * */
  _parseFIX (str) {
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
  _parseFIXOnLogon (logonFIXString) { 
    const dict = this._parseFIX(logonFIXString)
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
  _handleFIXLimitOrder (limitOrderFIXString) {
    const dict = this._parseFIX(limitOrderFIXString)
    return {
      msgType: 'LimitOrder',
      action: _.findKey(this.Action, dict[this.FIX.Action]),
      side: _.findKey(this.Side, this.FIX.Side),
      price: dict[this.FIX.Price],
      leavesQty: dict[this.FIX.LeavesQty],
      orderstatus: _.findKey(this.OrderStatus, this.FIX.OrdStatus),
      clientissued_orderID: dict[this.FIX.ClOrdID],
      account: dict[this.FIX.Account]
    }
  }

  /**
   Parse incoming FIX string
   * @param {String} FIX Balance string 
   * @returns {Object} a Balance object
   */
  _parseFIXBalance (balanceFIXString) {
    const dict = this._parseFIX(balanceFIXString)
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
   * @param {String} FIX Currency pair string message
   * @returns {Object} Map of currencypairs
   */
  _handleFIXCurrencyPair (currencyPairInput) {
    const dict = this._parseFIX(currencyPairInput)
    const currencypair = {
      msgType: 'CurrencyPair',
      currencyPairID: dict[this.FIX.CurrencyPairID],
      currencypairStr: dict[this.FIX.CurrencyPairStr].trim()
    }
    const id = parseInt(currencypair.currencyPairID)
    this.currencyPairIDs[ id ] = currencypair.currencypairStr
    this.currencyPairIDToStr[ id ] = currencypair.currencypairStr
    this.currencyPairStrToID[ currencypair.currencypairStr ] = id
    const parts = currencypair.currencypairStr.split('/')
    this.currencyPairIDToSrcDstPair[ id ] = [ parts[0], parts[1] ]
    return {
      msgType: 'CurrencyPair',
      currencyPairID: dict[this.FIX.CurrencyPairID],
      currencypairStr: dict[this.FIX.CurrencyPairStr].trim()
    }
  }

  /*
   * @input {String} FIX top of book message
   * @returns {Object} Map of top of book fields to values 
   */
  _parseFIXTopOfBook (t) {
    const dict = this._parseFIX(t)
    return {
      MsgType: 'TopOfBook',
      currencyPairID: dict[this.FIX.CurrencyPairID],
      depthnum: dict[this.FIX.DepthNum],
      bidPx: dict[this.FIX.BidPx].trim(),
      bidSize: dict[this.FIX.BidSize].trim(),
      offerPx: dict[this.FIX.OfferPx].trim(),
      offerSize: dict[this.FIX.OfferSize].trim()
    }
  }

  /*
   * Local callback 
   * @input {Object} Map of trader balances
   * @return {} 
   */
  _handleBalance (balanceObj) {
    this.traderBalances[ balanceObj.currencyID ] = balanceObj.amount
  }

  /*
   * Local callback 
   * @input {Object} Logon 
   * @return {} 
   */
  _handleLogon (logonObj) {
    this.nextvalidClientissuedorderID = logonObj.nextvalid_clientissuedorderID
    //sendLimitOrderTestBatch()
  }

  /*
   * Local callback 
   * @input {Object} Top of book
   * @return {} 
   */
  _handleTopOfBook (topOfBookObj) {
    this.bids[topOfBookObj.currencyPairID] = this.bids[topOfBookObj.currencyPairID] || {}
    this.asks[topOfBookObj.currencyPairID] = this.asks[topOfBookObj.currencyPairID] || {}

    this.bids[topOfBookObj.currencyPairID][topOfBookObj.depthnum] = {
      price: topOfBookObj.bidPx,
      size: topOfBookObj.bidSize
    }

    this.asks[topOfBookObj.currencyPairID][topOfBookObj.depthnum] = {
      price: topOfBookObj.offerPx,
      size: topOfBookObj.offerSize
    }
  }

	/**
	* Get a liquidity curve for the given parameters.
  * Return liquidity curve for currencypair P
	* @param {String} params.source_ledger The URI of the source ledger
	* @param {String} params.destination_ledger The URI of the destination ledger
	* @param {String} params.source_currency The source currency
	* @param {String} params.destination_currency The destination currency
	* @returns {Object}
	*/
  * getCurve (params) {
    const source = params.source_currency + '.' + params.source_ledger
    const destination = params.destination_currency + '.' + params.destination_ledger
    const currencyPair = source + '/' + destination  

    const result = this._getCurrencyPairId(params)
    const currencyPairId = result.currencyPairId
    const paymentDirectonIsSourceToDestination = !!this.currencyPairStrToID[currencyPair] 

    const bids = this.bids[currencyPairId]
    const asks = this.asks[currencyPairId]
    
    if (!bids || bids.length === 0) {
      throw new ServerError('No rate available for currency ' + params.source_currency)
    }

    if (!asks || asks.length === 0) {
      throw new ServerError('No rate available for currency ' + params.destination_currency)
    }

    const curvePoints = [[0, 0]]

    let srcSum = new BigNumber(0)
    let dstSum = new BigNumber(0)
    // Handle if it's source
    _.forEach( paymentDirectonIsSourceToDestination ? asks : bids, pricelevel => { 
      const price = new BigNumber(pricelevel.price)
      const size =  new BigNumber(pricelevel.size)

      // Ignore this one
      if (size.equals(new BigNumber(0))) return
      
      srcSum = new BigNumber(srcSum).plus(size)
      dstSum = new BigNumber(dstSum.plus(size.times(price)))
      curvePoints.push([srcSum.toNumber(), dstSum.toNumber()])
    })

    return { points: curvePoints }
  }

  /*
   * Local callback
   * @input {String} FIX string
   * @returns {}
   */
  _handleFIX (FIXMessage) {
    const str = FIXMessage.toString()
    if (!str.includes('FIX.4.4')) {
      console.log('Invalid FIX format ' + str)
        return
    }

    switch(str.match(/35=([a-zA-Z])/)[1]) {
      case this.MsgType.Logon:
        return this._handleLogon(this._parseFIXOnLogon(str))
      case this.MsgType.LimitOrder:
        return this._handleFIXLimitOrder(str)
      case this.MsgType.Balance:
        return this._handleBalance(this._parseFIXBalance(str))
      case this.MsgType.CurrencyPair:
        return this._handleFIXCurrencyPair(str)
      case this.MsgType.TopOfBook:
        return this._handleTopOfBook(this._parseFIXTopOfBook(str))
    }
  }

  /*
   * Local function
   * @input {String} url to get JSON from
   * @returm {String} JSON string 
  */
  _getContent (url) {
    // return new pending promise
    return new Promise((resolve, reject) => {
      // select http or https module, depending on reqested url
      const lib = url.startsWith('https') ? require('https') : require('http')
      const request = lib.get(url, response => {
        // handle http errors
        if (response.statusCode < 200 || response.statusCode > 299) {
          reject(new Error('Failed to load page, status code: ' + response.statusCode))
        }
        // temporary data holder
        const body = []
        // on every content chunk, push it to the data array
        response.on('data', chunk => body.push(chunk))
        // we are done, resolve promise with those joined chunks
        response.on('end', () => resolve(body.join('')))
      })
      // handle connection errors of the request
      request.on('error', reject)
    })
  }

  /*
   * Local function 
   * @input {String,String}
   * @return {String}
   */
  _buildOrderbookURL (exchange_name, currencypair) {
    switch(exchange_name) {
      case 'bitstamp':
        return 'https://www.bitstamp.net/api/v2/order_book/' + currencypair + '/'
      case 'bitso':
        return 'https://api.bitso.com/v2/order_book?book=' + currencypair
      case 'itbit':
        return 'https://api.itbit.com/v1/markets/' + currencypair + '/order_book'
      case 'mybitx':
        return 'https://api.mybitx.com/api/1/orderbook?pair=' + currencypair
      default:
        console.log('Error : URL not supported : ' + exchange_name)
    }
  }

  /**
   * Mock data can be provided for testing purposes
   */
  * connect(mockData) {
    this.sock.connect(this.backendUri + ':36002')
    this.multicastsub.connect(this.backendUri + ':36000')
    // Subscribe to all topics
    this.multicastsub.subscribe('')
    this.sock.send('8=FIX.4.4|35=n')

		this.multicastsub.on('message', message => {
      //console.log('<<< ' + message)
			this._handleFIX(message)
		})

		this.sock.on('message', message => {
      //console.log('<<< ' + message)
			this._handleFIX(message)
		})
    
    // TODO actually wait for the orderbook to populate
    return new Promise(resolve => {
      setTimeout(resolve, 4000)
    })
  }

  /**
   * Submits a limit order to FBME matching engine
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_amount The amount of the source asset we want to send
   * @param {String} params.destination_amount The amount of the destination asset we want to send
	 * // TODO Add {String} params.source_currency
	 * // TODO Add {String} params.destination_currency
   * @return {Integer} currencyPairId
   * @return {String} side
   */
  _getCurrencyPairId(params) {
    const source = params.source_currency + '.' + params.source_ledger
    const destination = params.destination_currency + '.' + params.destination_ledger
    const currencyPair = source + '/' + destination  
    const currencyPairFlipped = destination + '/' + source 
    // Does currencyPair exist
    const currencyPairId = this.currencyPairStrToID[currencyPair] || this.currencyPairStrToID[currencyPairFlipped] 
    const paymentDirectonIsSourceToDestination = !!this.currencyPairStrToID[currencyPair] 
    
    if (!currencyPairId) {
      throw new ServerError('No order book available for currency pair ' + currencyPair )
    }

    const side = paymentDirectonIsSourceToDestination ? this.Side.BUY : this.Side.SELL

    return {currencyPairId, side}
  }

  /**
   * Submits a limit order to FBME matching engine
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_amount The amount of the source asset we want to send
   * @param {String} params.destination_amount The amount of the destination asset we want to send
	 * // TODO Add {String} params.source_currency
	 * // TODO Add {String} params.destination_currency
   * @return {Promise.<null>}
   */
  * submitPayment (params) {
    const price = (new BigNumber(params.source_amount)).div(new BigNumber(params.destination_amount))

    let result = this._getCurrencyPairId(params)
    const side = result.side
    const currencyPairId = result.currencyPairId

		const limitorder = {
      msgType: 'LimitOrder',
      account: 1,
      action: this.Action.Transmit,
      side: side, 
      price: price,
      leavesQty: params.source_amount,
      currencyPairID: currencyPairId,
      orderstatus: this.OrderStatus.Submitted,
      clientissuedorderID: this.nextvalidClientissuedorderID,
      acklevel: this.AckLevel.SOFT_writtenToRAM,
      orderheld: this.OrderHeld.False,
      paymenteligible: this.PaymentEligible.True,
      ispersistent: this.PersistOrderFlag.False
    }

		this.nextvalidClientissuedorderID = this.nextvalidClientissuedorderID + 1

    const FIX = this._limitOrderToFIX(limitorder)
    this.sock.send(FIX)
    
    console.log(FIX)

		return Promise.resolve()
  }

  /**
   * Get backend status
   * @input {}
   * @return {String}
   */
  * getStatus () {
    return {
      backendStatus: healthStatus.statusOk
    }
  }

}

module.exports = FBMEBackend

