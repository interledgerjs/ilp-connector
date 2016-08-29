# ILP Connector [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-connector.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-connector
[circle-image]: https://circleci.com/gh/interledger/js-ilp-connector.svg?style=shield
[circle-url]: https://circleci.com/gh/interledger/js-ilp-connector
[codecov-image]: https://codecov.io/gh/interledger/js-ilp-connector/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledger/js-ilp-connector

> A reference implementation of the ILP Connector API

## Usage

You can see the connector in action as part of the [`five-bells-demo`](https://github.com/interledger/five-bells-demo)!

To run the connector as a standalone server, follow these directions.

Note: You need two [`five-bells-ledger`](https://github.com/interledger/five-bells-ledger) instances to trade between.

### Step 1: Clone repo

``` sh
git clone https://github.com/interledger/js-ilp-connector.git

cd js-ilp-connector
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

* `CONNECTOR_BIND_IP` (default: `0.0.0.0`) IP that ILP Connector will bind to.
* `CONNECTOR_PORT` (default: `4000`) Port that ILP Connector will listen on.
* `CONNECTOR_HOSTNAME` (default: *[your hostname]*) Publicly visible hostname. This is important for things like generating globally unique IDs. Make sure this is a hostname that all your clients will be able to see. The default should be fine for local testing.
* `CONNECTOR_PUBLIC_PORT` (default: `$PORT`) Publicly visible port. You can set this if your public port differs from the listening port, e.g. because the connector is running behind a proxy.
* `CONNECTOR_PUBLIC_HTTPS` (default: `''`) Whether or not the publicly visible instance of ILP Connector is using HTTPS.
* `CONNECTOR_LOG_LEVEL` (default: `info`) the allowed levels in order of verbosity are `fatal`, `error`, `warn`, `info`, `debug`, and `trace`

#### Trading

* `CONNECTOR_LEDGERS` (default: `[]`) Ledgers where this connector has accounts. Used to auto-generate `CONNECTOR_PAIRS`.
```js
[
  "USD@example.usd-ledger.",
  "EUR@example.eur-ledger."
]
```
* `CONNECTOR_CREDENTIALS` (default: `{}`) Connector's login credentials for various ledgers, ex.
```js
{
  // Using Basic Auth
  "<ledger_address>": {
    "account": "...",
    "username": "...",
    "password": "..."
    "ca": "...", // Optional
  },

  // Using Client Certificate Auth
  "<ledger_address_2>": {
    "account": "...",
    "username": "...",
    "cert": "...",
    "key": "...",
    "ca": "...", // Optional
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

* `CONNECTOR_NOTIFICATION_VERIFY` (default: `'true'` if `NODE_ENV=production` else `false`) The connector verifies  signatures on notifications.
* `CONNECTOR_NOTIFICATION_KEYS` (default: none) The paths to files with the public key in PEM format to verify ledgers' notification signatures. Required if `CONNECTOR_NOTICATION_VERIFY='true'`
ex.
```js
{
  "<ledger_uri": "<path-to-file>"
}
```

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

## Running with Docker

This project can be run in a [Docker](https://www.docker.com/) container.


``` sh
docker run -it --rm -e CONNECTOR_PORT=4000 interledger/js-ilp-connector
```

Breaking down that command:

* `-it` Run ILP Connector in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e CONNECTOR_PORT=4000` Set the connector's port to 4000. This is just an example for how to set a config option.

## Payments

The connector will facilitate an interledger payment upon receiving a notification for a transfer in which it is credited. That "source" transfer must have a `ilp_header` in its credit's `memo` that specifies the payment's destination and amount.
As soon as the source transfer is prepared, the connector will authorize the debits from its account(s) on the destination ledger.
