'use strict'

function getPairs (config, tradingPairsService) {
  const tradingPairs = tradingPairsService.toArray()
  return tradingPairs.map((pair) => {
    const currencies = pair.map(function (currencyLedgerString) {
      return currencyLedgerString.split('@')
    })
    return {
      source_asset: currencies[0][0],
      source_ledger: currencies[0][1],
      destination_asset: currencies[1][0],
      destination_ledger: currencies[1][1]
    }
  })
}

module.exports = {
  getPairs: getPairs
}
