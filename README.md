# Five Bells Trader [![Circle CI](https://circleci.com/gh/ripple/five-bells-trader/tree/master.svg?style=svg&circle-token=048dca3034e51bc8b860ccf2e518f0b431e59b38)](https://circleci.com/gh/ripple/five-bells-trader/tree/master) [![Docker Repository on Quay.io](https://quay.io/repository/ripple/five-bells-trader/status?token=e232cc8f-9d65-4e41-9cac-dbce38ede72f "Docker Repository on Quay.io")](https://quay.io/repository/ripple/five-bells-trader) [![Coverage Status](https://coveralls.io/repos/ripple/five-bells-trader/badge.svg?branch=master&t=nRjW7M)](https://coveralls.io/r/ripple/five-bells-trader?branch=master)

> A reference implementation of the Five Bells Trader API

## Usage

You can see the trader in action as part of the [`five-bells-demo`](https://github.com/interledger/five-bells-demo)!

To run the trader as a standalone server, follow these directions.

Note: You need two [`five-bells-ledger`](https://github.com/interledger/five-bells-ledger) instances to trade between.

### Step 1: Clone repo

``` sh
git clone https://github.com/intertrader/five-bells-trader.git
cd five-bells-trader
```

### Step 2: Install dependencies

``` sh
npm install
```

### Step 3: Run it!

``` sh
npm start
```

### Configuration

#### General

* `TRADER_BIND_IP` (default: `0.0.0.0`) IP that Five Bells Trader will bind to.
* `TRADER_PORT` (default: `4000`) Port that Five Bells Trader will listen on.
* `TRADER_HOSTNAME` (default: *[your hostname]*) Publicly visible hostname. This is important for things like generating globally unique IDs. Make sure this is a hostname that all your clients will be able to see. The default should be fine for local testing.
* `TRADER_PUBLIC_PORT` (default: `$PORT`) Publicly visible port. You can set this if your public port differs from the listening port, e.g. because the trader is running behind a proxy.
* `TRADER_PUBLIC_HTTPS` (default: `''`) Whether or not the publicly visible instance of Five Bells Trader is using HTTPS.

#### Trading

* `TRADING_PAIRS` (default: `[]`) Pairs to trade on, ex.
```js
[
  [
    'USD@http://ledger1.example',
    'EUR@http://ledger2.example'
  ],[
    'EUR@http://ledger2.example',
    'USD@http://ledger1.example'
  ]
]
```
* `TRADER_CREDENTIALS` (default: `{}`) Trader's login credentials, ex.
```js
{
   "<ledger_uri>": {
     "account_uri": "...",
     "username": "...",
     "password": "..."
   }
}
```
* `TRADER_DEBUG_AUTOFUND` (default: `''`) Debug feature which uses corresponding ledger debug 
* `TRADER_FX_SPREAD` (default: `0.002` =.2%) How much of a spread to add on top of the reference exchange rate. This determines the trader's margin.
* `TRADER_MIN_MESSAGE_WINDOW` (default: `1`) Minimum time the trader wants to budget for getting a message to the ledgers its trading on. In seconds.
* `TRADER_MAX_HOLD_TIME` (default: `10`) Maximum duration the trader is willing to place funds on hold while waiting for the outcome of a transaction. In seconds.

## Running with Docker

This project can be run in a [Docker](https://www.docker.com/) container.


``` sh
docker run -it --rm -e PORT=4000 quay.io/ripple/five-bells-trader
```

Breaking down that command:

* `-it` Run Five Bells Trader in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e PORT=4000` Set the trader's port to 4000. This is just an example for how to set a config option.
