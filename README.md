# ILP Connector [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-connector.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-connector
[circle-image]: https://circleci.com/gh/interledgerjs/ilp-connector.svg?style=shield
[circle-url]: https://circleci.com/gh/interledgerjs/ilp-connector
[codecov-image]: https://codecov.io/gh/interledgerjs/ilp-connector/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp-connector

> A reference implementation of the ILP Connector API

## Usage

You can see the connector in action as part of the [`five-bells-demo`](https://github.com/interledgerjs/five-bells-demo)!

To run the connector as a standalone server, follow these directions.

Note: You need two [`five-bells-ledger`](https://github.com/interledgerjs/five-bells-ledger) instances to trade between.

### Step 1: Clone repo

``` sh
git clone https://github.com/interledgerjs/ilp-connector.git

cd ilp-connector
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

* `CONNECTOR_LOG_LEVEL` (default: `info`) the allowed levels in order of verbosity are `fatal`, `error`, `warn`, `info`, `debug`, and `trace`
* `DB_URI` (default: none) the database for the connector to use for plugin stores.

#### Trading

* `CONNECTOR_LEDGERS` (default: `{}`) Connector's login credentials for ledgers where it has accounts. Used to auto-generate `CONNECTOR_PAIRS`.
```js
{
  // Using Basic Auth
  "example.usd-ledger.": {
    "store": true // if the plugin requires a store, it should set this to true
    "currency": "USD", // asset on this ledger
    "plugin": "ilp-plugin-bells", // module for this ledger plugin
    "options": { // actual plugin options passed into plugin constructor
      "account": "...",
      "username": "...",
      "password": "..."
      "ca": "...", // Optional
    }
  },

  // Using Client Certificate Auth
  "example.eur-ledger.": {
    "currency": "EUR",
    "plugin": "ilp-plugin-bells",
    "options": {
      "account": "...",
      "username": "...",
      "cert": "...",
      "key": "...",
      "ca": "...", // Optional
    }
  }
}
```
* `CONNECTOR_PAIRS` (default: *[all possible combinations]*) Pairs to trade on, ex.
```js
[
  [
    'USD@example.ledger1.',
    'EUR@example.ledger2.'
  ],[
    'EUR@example.ledger2.',
    'USD@example.ledger1.'
  ]
]
```

* `CONNECTOR_ROUTES` (default: `[]`) Explicitly add routes to the connector. If `targetPrefix` is the most specific
  route name that matches a destination, then the payment will be forwarded to `connectorAccount` on `connectorLedger`. ex:
```js
[
  {
    "targetPrefix": "", // matches any destination
    "connectorLedger": "ilpdemo.red."
    "connectorAccount": "ilpdemo.red.connie"
  }, {
    "targetPrefix": "cny.",
    "connectorLedger": "ilpdemo.red."
    "connectorAccount": "lpdemo.red.cny_connector"
  }
]
```

* `CONNECTOR_PEERS` (default: `''`) Provide a basic comma-separated list of peers. Each peer is a connector's ILP address, on which known routes are used in order to broadcast routes, to receive routes, and to send payments.
* `CONNECTOR_AUTOLOAD_PEERS` (default: `false`) Whether to automatically populate the list of peers by calling getConnectors on all ledger plugins

* `CONNECTOR_FX_SPREAD` (default: `0.002` =.2%) How much of a spread to add on top of the reference exchange rate. This determines the connector's margin.
* `CONNECTOR_SLIPPAGE` (default: `0.001` = 0.1%) The ratio for overestimating exchange rates to prevent payment failure if the rate changes.
* `CONNECTOR_MIN_MESSAGE_WINDOW` (default: `1`) Minimum time the connector wants to budget for getting a message to the ledgers its trading on. In seconds.
* `CONNECTOR_MAX_HOLD_TIME` (default: `10`) Maximum duration (seconds) the connector is willing to place funds on hold while waiting for the outcome of a transaction.
* `CONNECTOR_AUTH_CLIENT_CERT_ENABLED` (default `0`) whether or not to enable TLS Client Certificate authentication (requires HTTPS).
* `CONNECTOR_USE_HTTPS` (default `0`) whether or not to run the server using HTTPS.
* `CONNECTOR_TLS_KEY` (default: none) the path to the server private key file. Required if using HTTPS.
* `CONNECTOR_TLS_CERTIFICATE` (default: none) the path to the server certificate file. Required if using HTTPS.
* `CONNECTOR_TLS_CRL` (default: none) the path to the server certificate revokation list file. Optional if using HTTPS.
* `CONNECTOR_TLS_CA` (default: none) the path to a trusted certificate to be used in addition to using the [default list](https://github.com/nodejs/node/blob/v4.3.0/src/node_root_certs.h). Optional if using HTTPS.
* `CONNECTOR_ROUTE_BROADCAST_ENABLED` (default: `1`) whether or not to broadcast known routes.
* `CONNECTOR_ROUTE_BROADCAST_INTERVAL` (default: `30000`) the frequency at which the connector broadcasts its routes to adjacent connectors.
* `CONNECTOR_ROUTE_CLEANUP_INTERVAL` (default: `1000`) the frequency at which the connector checks for expired routes.
* `CONNECTOR_ROUTE_EXPIRY` (default: `45000`) the maximum age of a route.
* `CONNECTOR_BACKEND` (default: `'fixerio'`) the backend used to determine rates. This can either be a module name from `src/backends/` or a different module that will be `require()`ed by the connector.

## Running with Docker

This project can be run in a [Docker](https://www.docker.com/) container.


``` sh
docker run -it --rm -e CONNECTOR_SLIPPAGE='0.002' interledgerjs/ilp-connector
```

Breaking down that command:

* `-it` Run ILP Connector in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e CONNECTOR_SLIPPAGE='0.002'` Set the connector's slippage to 0.002. This is just an example for how to set a config option.

## Payments

The connector will facilitate an interledger payment upon receiving a notification for a transfer in which it is credited. That "source" transfer must have a `ilp_header` in its credit's `memo` that specifies the payment's destination and amount.
As soon as the source transfer is prepared, the connector will authorize the debits from its account(s) on the destination ledger.

## Backend

### Class: Backend
#### Methods

| `new` | [**Backend**](#new-backend) ( opts ) |
| | [**connect**](#connect) ( ) `⇒ Promise.<null>` |
| | [**getCurve**](#getCurve) ( params ) `⇒ Promise.<Curve>` |

##### new Backend
<code>new Backend( **opts** : Object )</code>

###### Parameters
| Name | Type | Description |
|:--|:--|:--|
| `opts` | `Object` | |
| `opts.backendUri` | `URI` | (see `CONNECTOR_BACKEND_URI`) |
| `opts.currencyWithLedgerPairs` | `TradingPairs` | currency pairs supported by the connector |
| `opts.getInfo` | `Function(ledger) → LedgerInfo` | a function to retrieve ledger metadata |
| `opts.spread` | `Number` | (see `CONNECTOR_FX_SPREAD`) |

#### connect
<code>backend.connect() ⇒ Promise.&lt;null></code>

#### getCurve
<code>backend.getCurve( **params** : [CurveParams](#class-curveparams) ) ⇒ Promise.&lt;Curve></code>

### Class: CurveParams
###### Fields
| Type | Name | Description |
|:--|:--|:--|
| `String` | `source_ledger` | The URI of the source ledger |
| `String` | `destination_ledger` | The URI of the destination ledger |

### Class: Curve
###### Fields
| Type | Name | Description |
|:--|:--|:--|
| `Point[]` | `points` | A list of `[source, destination]` points representing a liquidity curve |
| `Object` | `additional_info` | (optional) |
