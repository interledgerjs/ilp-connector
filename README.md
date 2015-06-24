# Five Bells Trader [![Circle CI](https://circleci.com/gh/ripple/five-bells-trader/tree/master.svg?style=svg&circle-token=048dca3034e51bc8b860ccf2e518f0b431e59b38)](https://circleci.com/gh/ripple/five-bells-trader/tree/master) [![Docker Repository on Quay.io](https://quay.io/repository/ripple/five-bells-trader/status?token=e232cc8f-9d65-4e41-9cac-dbce38ede72f "Docker Repository on Quay.io")](https://quay.io/repository/ripple/five-bells-trader) [![Coverage Status](https://coveralls.io/repos/ripple/five-bells-trader/badge.svg?branch=master&t=nRjW7M)](https://coveralls.io/r/ripple/five-bells-trader?branch=master)

> A reference implementation of the Five Bells Trader API

## Usage (Docker)

Note: You need two [Five Bells Ledger](https://github.com/ripple/five-bells-ledger) instances to trade between.

Afterwards just run Five Bells Trader:

``` sh
docker run -it --rm -e PORT=4000 quay.io/ripple/five-bells-trader
```

Breaking down that command:

* `-it` Run Five Bells Trader in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e PORT=4000` Set the trader's port to 4000. This is just an example for how to set a config option.

### Configuration

#### General

* `BIND_IP` (default: `0.0.0.0`) IP that Five Bells Trader will bind to.
* `PORT` (default: `4000`) Port that Five Bells Trader will listen on.
* `HOSTNAME` (default: *[your hostname]*) Publicly visible hostname. This is important for things like generating globally unique IDs. Make sure this is a hostname that all your clients will be able to see. The default should be fine for local testing.
* `PUBLIC_PORT` (default: `$PORT`) Publicly visible port. You can set this if your public port differs from the listening port, e.g. because the ledger is running behind a proxy.
* `PUBLIC_HTTPS` (default: `''`) Whether or not the publicly visible instance of Five Bells Trader is using HTTPS.

#### Trading

* `TRADER_ID` (default: `mark`) Account ID of the trading account.
* `TRADING_PAIRS` (default: `[]`) Pairs to trade on, ex. `[['USD@http://ledger1.example', 'EUR@http://ledger2.example'],['EUR@http://ledger2.example', 'USD@http://ledger1.example']]`
* `TRADER_DEBUG_AUTOFUND` (default: `''`) Debug feature which uses corresponding ledger debug features to automatically create and fund the trader's accounts.
* `TRADER_FX_API` (default: `http://api.fixer.io/latest`) FX rate endpoint. This sets the reference exchange rates the trader bases its quotes on.
* `TRADER_FX_CACHE_TTL` (default: `86400000` =24h) How long the FX rates should be cached. In milliseconds.
* `TRADER_FX_SPREAD` (default: `0.002` =.2%) How much of a spread to add on top of the reference exchange rate. This determines the trader's margin.
* `MIN_MESSAGE_WINDOW` (default: `1`) Minimum time the trader wants to budget for getting a message to the ledgers its trading on. In seconds.
* `MAX_HOLD_TIME` (default: `10`) Maximum duration the trader is willing to place funds on hold while waiting for the outcome of a transaction. In seconds.
* `REJECTION_CREDIT_PERCENTAGE` (default: `0.01` =1%) How much the trader wishes to charge for failed transactions. Expressed as a percentage of the principle, so `0.01` means: If the transaction fails the trader receives 1% of the money she would have received if the trade went through. This revenue is intended to pay for the time that the trader had to place the funds on hold.
