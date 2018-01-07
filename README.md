# ILP Connector [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-connector.svg?style=flat

[npm-url]: https://npmjs.org/package/ilp-connector

[circle-image]: https://circleci.com/gh/interledgerjs/ilp-connector.svg?style=shield

[circle-url]: https://circleci.com/gh/interledgerjs/ilp-connector

[codecov-image]: https://codecov.io/gh/interledgerjs/ilp-connector/branch/master/graph/badge.svg

[codecov-url]: https://codecov.io/gh/interledgerjs/ilp-connector

> A reference implementation of the ILP Connector

## Table of Contents

* [Overview](#overview)

  * [What is this?](#what-is-this)
  * [Who is this for?](#who-is-this-for)

* [Quickstart](#quickstart)

* [Guides](#guides)

  * [Connect your connector to the Interledger](#connect-your-connector-to-the-interledger)
  * [Allow your apps to connect to your connector](#allow-your-apps-to-connect-to-your-connector)
  * [Embed a connector in another JavaScript app](#embed-a-connector-in-another-javascript-app)
  * [Create a tier-1 connector](#create-a-tier-1-connector)
  * [Run the connector in Docker](#run-the-connector-in-docker)

* [Reference](#reference)

  * [Configuration Variables](#configuration-variables)
  * [API Reference](#api-reference)
  * [Extensibility: Plugins](#extensibility-plugins)
  * [Extensibility: Stores](#extensibility-stores)
  * [Extensibility: Middlewares](#extensibility-middlewares)
  * [Extensibility: Backends](#extensibility-backends)

* [Development](#development)

## Overview

### What is this?

This is a JavaScript reference implementation of an [Interledger](https://interledger.org) connector. Find out more about the [Interledger architecture](https://interledger.org/rfcs/0001-interledger-architecture/) and [Interledger protocol](https://interledger.org/rfcs/0003-interledger-protocol/).

An Interledger connector forwards Interledger packets, just like an Internet router forward Internet packets. The difference is that Interledger packets represent value in addition to data. Interledger connectors do not actually move the money, they rely on [plugins](https://interledger.org/rfcs/0004-ledger-plugin-interface/) for settlement. Plugins may settle by making a payment on an external payment system like ACH or they may use payments channels over a digital asset ledger like XRP Ledger or Bitcoin. Some plugins may not settle at all - this is useful for example when the plugin connects two hosts owned by the same person.

### Who is this for?

Just like IP routers can be found anywhere from your home wifi router to a small business network to the large Internet backbones, an Interledger connector is a versatile component that appears in a lot of different context. Here are some example use cases:

#### Your personal connector

You could be a developer who runs an Interledger connector so you can point all of your apps to it. This would allow you to change Interledger providers just by reconfiguring your connector without having to update the credentials in every single one of your apps.

It also gives you a single place to manage your money. This version of the connector is pretty rudimentary, but in the future it will be able to tell you which app spent how much and when they sent it, how much each app earned etc.

#### The heart of an Interledger Service Provider (ILSP)

An Interledger Service Provider (ILSP) is the Interledger equivalent of an Internet Service Provider (ISP). It's an entity that provides access to the Interledger network for its users.

Each ILSP needs to have one or more connectors to route the ILP packets from its customers to the Interledger and vice versa.

Some ILSPs are simply customers of a larger ILSP. Others are so-called tier-1 ILSPs. Tier-1 ILSPs have a special responsibility, they provide routing services for the network.

This implementation of the connector contains a routing protocol implementation for tier-1 connectors. Please note that in order to become a tier-1 connector you need to have a relationship with one or more existing tier-1 connectors and they need to trust you not to overwhelm them with traffic or harbor malicious customers on your network.

## Quickstart

```sh
npm install -g ilp-connector ilp-plugin-btp
CONNECTOR_STORE_PATH=~/.connector-data CONNECTOR_ACCOUNTS='{}' CONNECTOR_ILP_ADDRESS=test.quickstart ilp-connector
```

You are now running a connector!

##### What's next?

* [Connect your connector to the Interledger](#connect-your-connector-to-the-interledger)
* [Allow your apps to connect to your connector](#allow-your-apps-to-connect-to-your-connector)
* [Embed a connector in another JavaScript app](#embed-a-connector-in-another-javascript-app)
* [Create a tier-1 connector](#create-a-tier-1-connector)
* [Run the connector in Docker](#run-the-connector-in-docker)

## Guides

### Connect your connector to the Interledger

In order to connect your connector to the Interledger, you need to configure a plugin representing your account with an Interledger Service Provider (ILSP).

You will configure this plugin as a `parent` plugin, which means that your connector will automatically fetch its ILP address from this ILSP and send all its traffic through it. Your ILSP will tell you the other settings you need to use.

From here on your configuration will get more complicated. So let's use the [PM2](https://github.com/Unitech/pm2) process manager, which allows us to specify our configuration in one tidy JavaScript config file.

##### launch.config.js

```js
'use strict'

const path = require('path')

const parentConnector = {
  // This tells our connector that this is our main upstream link which will
  // automatically make it our default route and load our ILP address from it.
  relation: 'parent',
  assetScale: 6,
  assetCode: 'XRP',
  plugin: 'ilp-plugin-xrp-asym',
  options: {

  }
}

const connectorApp = {
  name: 'connector',
  env: {
    // The one-to-one backend will use an exchange rate of 1:1 for everything
    CONNECTOR_BACKEND: 'one-to-one',

    // We don't want to charge any fee
    CONNECTOR_SPREAD: '0',

    // Where is our database stored
    CONNECTOR_STORE_PATH: '/home/bob/connector',

    // Configure our plugins
    CONNECTOR_ACCOUNTS: JSON.stringify({
      // `up` is an arbitrary name we give to our parent connector
      up: parentConnector
    })
  },
  script: path.resolve(process.execPath, '../../lib/node_modules/ilp-connector/src/index.js')
}

module.exports = { apps: [ connectorApp ] }
```

Now we can run our connector with:

```sh
npm install -g pm2
pm2 start launch.config.js
```

### Allow your apps to connect to your connector

**TODO**

### Embed a connector in another JavaScript app

**TODO**

### Create a tier-1 connector

**TODO**

### Run the connector in Docker

This project can be run in a [Docker](https://www.docker.com/) container.

```sh
docker run -it --rm -e CONNECTOR_SPREAD='0.005' interledgerjs/ilp-connector
```

Breaking down that command:

* `-it` Run ILP Connector in an interactive terminal.
* `--rm` Delete container when it's done running.
* `-e CONNECTOR_SPREAD='0.005'` Set the connector's spread to 0.5%. This is an example for how to pass configuration to the connector.

## Reference

### Configuration Variables

<!-- WARNING: This section is auto-generated. Please do not edit in README.md -->

#### `ilpAddress`

* Environment: `CONNECTOR_ILP_ADDRESS`
* Type: `string`
* Default: `"unknown"`

ILP address of the connector. This property can be omitted if an account with `relation=parent` is configured under `accounts`.

#### `accounts`

* Environment: `CONNECTOR_ACCOUNTS`
* Type: `object`
* Default: `{}`

| Name                  | Type    | Description                                                                                                                                                                                                                                                                                         |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*`                   | object  | Description of individual account.                                                                                                                                                                                                                                                                  |
| `*.relation`          | string  | Relationship between the connector and the counterparty that the account is with.                                                                                                                                                                                                                   |
| `*.plugin`            | string  | Name of the ILP plugin that should be used for this account.                                                                                                                                                                                                                                        |
| `*.assetCode`         | string  | Currency code or other asset identifier that will be passed to the backend to select the correct rate for this account.                                                                                                                                                                             |
| `*.assetScale`        | integer | Interledger amounts are integers, but most currencies are typically represented as fractional units, e.g. cents. This property defines how many Interledger units make up one regular units. For dollars, this would usually be set to 9, so that Interledger amounts are expressed in nanodollars. |
| `*.ilpAddressSegment` | string  | _Optional_ What segment will be appended to the connector's ILP address to form this account's ILP address. Only applicable to accounts with `relation=child`. Defaults to the id of the account, i.e. the key used in the `accounts` config object.                                                |
| `*.options.*`         | object  | _Optional_                                                                                                                                                                                                                                                                                          |
| `*.receiveRoutes`     | boolean | _Optional_ Whether we should receive and process route broadcasts from this peer. Defaults to `true` for `relation=peer` and `false` otherwise.                                                                                                                                                     |
| `*.sendRoutes`        | boolean | _Optional_ Whether we should broadcast routes to this peer. Defaults to `true` for `relation=peer` and `false` otherwise.                                                                                                                                                                           |

#### `routes`

* Environment: `CONNECTOR_ROUTES`
* Type: `array`
* Default: `[]`

| Name              | Type   | Description                                                                                                                                                                                                 |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[]`              | object | Description of a route entry.                                                                                                                                                                               |
| `[].targetPrefix` | string | ILP address prefix that this route applies to. Configured routes take precedence over the same or shorter prefixes that are local or published by peers. More specific prefixes will still take precedence. |
| `[].peerId`       | string | ID of the account that destinations matching `targetPrefix` should be forwarded to. Must be one of the accounts in `accounts`.                                                                              |

#### `spread`

* Environment: `CONNECTOR_SPREAD`
* Type: `number`
* Default: `0.002`

How much of a spread to add on top of the reference exchange rate. Determines the connector's margin.

#### `slippage`

* Environment: `CONNECTOR_SLIPPAGE`
* Type: `number`
* Default: `0.001`

The ratio for overestimating exchange rates during quotes to prevent payment failure if the rate changes.

#### `minMessageWindow`

* Environment: `CONNECTOR_MIN_MESSAGE_WINDOW`
* Type: `integer`
* Default: `1000`

Minimum time the connector wants to budget for getting a message to the accounts its trading on. In milliseconds.

#### `maxHoldTime`

* Environment: `CONNECTOR_MAX_HOLD_TIME`
* Type: `integer`
* Default: `10000`

Maximum duration (in milliseconds) the connector is willing to place funds on hold while waiting for the outcome of a transaction.

#### `routeBroadcastEnabled`

* Environment: `CONNECTOR_ROUTE_BROADCAST_ENABLED`
* Type: `boolean`
* Default: `true`

Whether to broadcast known routes.

#### `routeBroadcastInterval`

* Environment: `CONNECTOR_ROUTE_BROADCAST_INTERVAL`
* Type: `integer`
* Default: `30000`

Frequency at which the connector broadcasts its routes to adjacent connectors. (in milliseconds)

#### `routeCleanupInterval`

* Environment: `CONNECTOR_ROUTE_CLEANUP_INTERVAL`
* Type: `integer`
* Default: `1000`

The frequency at which the connector checks for expired routes. (in milliseconds)

#### `routeExpiry`

* Environment: `CONNECTOR_ROUTE_EXPIRY`
* Type: `integer`
* Default: `45000`

The maximum age of a route provided by this connector. (in milliseconds)

#### `quoteExpiry`

* Environment: `CONNECTOR_QUOTE_EXPIRY`
* Type: `integer`
* Default: `45000`

The maximum age of a quote provided by this connector. (in milliseconds)

#### `backend`

* Environment: `CONNECTOR_BACKEND`
* Type: `string`
* Default: `"fixerio"`

Name of the backend (can be built-in or a require-able module name). Built-in modules are: fixerio, fixerio-plus-xrp, fixerio-plus-coinmarketcap, one-to-one

#### `store`

* Environment: `CONNECTOR_STORE`
* Type: `string`
* Default: `"leveldown"`

Name of the store (can be built-in or a require-able module name). Built-in modules are: leveldown

#### `storePath`

* Environment: `CONNECTOR_STORE_PATH`
* Type: `string`
* Default: `""`

Shorthand for `config.storeConfig.path`.

#### `storeConfig`

* Environment: `CONNECTOR_STORE_CONFIG`
* Type: `object`
* Default: `{}`

Additional options to be passed to the `store`'s constructor.

#### `broadcastCurves`

* Environment: `CONNECTOR_BROADCAST_CURVES`
* Type: `boolean`
* Default: `true`

Whether to include liquidity curves when broadcasting routes.

#### `reflectPayments`

* Environment: `CONNECTOR_REFLECT_PAYMENTS`
* Type: `boolean`
* Default: `true`

Whether to allow routing payments back to the account that sent them.

#### `initialConnectTimeout`

* Environment: `CONNECTOR_INITIAL_CONNECT_TIMEOUT`
* Type: `integer`
* Default: `10000`

How long the connector should wait for account plugins to connect before launching other subsystems. (in milliseconds)

### API Reference

### Extensibility: Plugins

Plugins represent different ways to link senders, receivers and connectors together. Most plugins use [Bilateral Transfer Protocol (BTP)](https://github.com/interledger/rfcs/blob/master/0023-bilateral-transfer-protocol/0023-bilateral-transfer-protocol.md) in order to communicate. The main differences between plugins are whether they are **multi-user** and which **settlement ledger** they use.

Multi-user plugins are plugins which connect to multiple counterparties, rather than just one. They are usually used as server-side plugins to serve a large number of clients. An example is [**ilp-plugin-mini-accounts**](https://github.com/interledgerjs/ilp-plugin-mini-accounts). Multi-user plugins actually contain a little mini connector internally which knows how to route packets to the correct client.

Plugins implement the [Ledger Plugin Interface (LPI)](https://github.com/interledger/rfcs/pull/347). To write your own plugin, consider extending [ilp-plugin-btp](https://github.com/interledgerjs/ilp-plugin-btp) for single-user plugins and [ilp-plugin-mini-accounts](https://github.com/interledgerjs/ilp-plugin-mini-accounts) for multi-user plugins. Check the list below for plugins you can copy as a starting point.

#### ilp-plugin-btp

* Multi-user: No
* Settlement: None
* Github: [interledgerjs/ilp-plugin-btp](https://github.com/interledgerjs/ilp-plugin-btp)
* NPM: [ilp-plugin-btp](https://www.npmjs.com/package/ilp-plugin-btp)

Plain BTP plugin, used to connect two parties without settling. Often used as a client for [ilp-plugin-mini-accounts](#ilp-plugin-mini-accounts).

#### ilp-plugin-mini-accounts

* Multi-user: Yes
* Settlement: None
* Github: [interledgerjs/ilp-plugin-mini-accounts](https://github.com/interledgerjs/ilp-plugin-mini-accounts)
* NPM: [ilp-plugin-mini-accounts](https://www.npmjs.com/package/ilp-plugin-mini-accounts)

Plain BTP multi-user plugin. You could run mini-accounts on your connector and then connect all of your own clients to it.

#### ilp-plugin-xrp-paychan

* Multi-user: No
* Settlement: [XRP Payment Channels](https://ripple.com/build/payment-channels-tutorial/)
* Github: [interledgerjs/ilp-plugin-xrp-paychan](https://github.com/interledgerjs/ilp-plugin-xrp-paychan)
* NPM: [ilp-plugin-xrp-paychan](https://www.npmjs.com/package/ilp-plugin-xrp-paychan)

Basic plugin for peering with settlement over XRP payment channels.

#### ilp-plugin-lightning

* Multi-user: No
* Settlement: [Lightning Network](https://lightning.network/)
* Github: [interledgerjs/ilp-plugin-lightning](https://github.com/interledgerjs/ilp-plugin-lightning)
* NPM: [ilp-plugin-lightning](https://www.npmjs.com/package/ilp-plugin-lightning)

ILP peering using settlement over Lightning.

### Extensibility: Stores

Stores represent different means for persistence for the connector.

#### Built-in: leveldown

Connector store based on [levelup](https://github.com/level/levelup)/[leveldown](https://github.com/Level/leveldown)

#### Built-in: memdown

Pure in-memory store. Resets every time the connector is run. Useful for development and testing.

### Extensibility: Middlewares

**TODO**

### Extensibility: Backends

Backends provide fee policies and exchange rates. For a professionally run connector, just should create your own backend, using exchange rates that come directly from the exchange or broker where you plan to trade to re-balance your accounts.

#### Built-in: one-to-one

* Supported currencies: _any_

The `one-to-one` backend applies the `CONNECTOR_SPREAD` setting, the `assetScale` settings, and otherwise uses a 1:1 exchange rate for all assets. This is the simplest backend, recommended for connectors that deal in only one currency.

#### Built-in: fixerio

* Supported currencies: see [fixer.io](http://fixer.io/)

The `fixerio` backend loads fiat exchange rates from [fixer.io](http://fixer.io/). **Suitable for development and experimental use only.**

#### Built-in: fixerio-plus-xrp

* Supported currencies: see [fixer.io](http://fixer.io/), XRP

The `fixerio-plus-xrp` backend loads fiat exchange rates from [fixer.io](http://fixer.io/) and XRP exchange rates from the [Ripple Data API](https://ripple.com/build/data-api-v2/). **Suitable for development and experimental use only.**

#### Built-in: fixerio-plus-coinmarketcap

* Supported currencies: see [fixer.io](http://fixer.io/), see [CoinMarketCap](https://coinmarketcap.com/)

The `fixerio-plus-coinmarketcap` backend loads fiat exchange rates from [fixer.io](http://fixer.io/) and crypto-currency exchange rates from [CoinMarketCap](https://coinmarketcap.com/). **Suitable for development and experimental use only.**

## Development

If you would like to contribute back to this project, please follow these steps:

#### Step 1: Clone repo

```sh
git clone https://github.com/interledgerjs/ilp-connector.git
cd ilp-connector
```

#### Step 2: Install dependencies

```sh
npm install
```

#### Step 3: Run it!

```sh
npm start
```

#### Step 4: Read the contributor guidelines

See [CONTRIBUTE.md](/CONTRIBUTE.md).
