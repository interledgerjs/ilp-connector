'use strict'

const requestUtil = require('@ripple/five-bells-shared/utils/request')
const config = require('../services/config')
const Settlements = require('../services/settlements')

/* eslint-disable */
/**
 * @api {put} /settlements/:id
 *
 * @apiName CreateSettlement
 * @apiGroup Settlements
 *
 * @apiParam {UUID} id Settlement UUID
 * @apiParam {Transfer[]} source_transfers Array of source transfers that credit the trader
 * @apiParam {Transfer[]} destination_transfers Array of destination transfers that debit the trader
 *
 * @apiExample {shell} One-to-one Settlement:
 *    curl -x PUT -H "Content-Type: application/json" -d
 *    '{
 *       "id": "c9377529-d7df-4aa1-ae37-ad5148612003",
 *       "source_transfers":[{
 *         "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *         "ledger":"http://usd-ledger.example/USD",
 *         "debits":[{
 *           "amount":"1.07",
 *           "account":"http://usd-ledger.example/accounts/alice"
 *         }],
 *         "credits":[{
 *           "amount":"1.07",
 *           "account":"http://usd-ledger.example/accounts/mark"
 *         }],
 *         "execution_condition": {
 *           "message_hash": "claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==",
 *           "signer": "http://ledger.example",
 *           "type": "ed25519-sha512",
 *           "public_key": "Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c="
 *         },
 *         "expires_at": "2015-06-16T00:00:11.000Z",
 *         "state": "prepared"
 *       }],
 *       "destination_transfers":[{
 *         "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *         "ledger":"http://eur-ledger.example/EUR",
 *         "debits":[{
 *           "amount":"1.00",
 *           "account":"http://eur-ledger.example/accounts/mark"
 *         }],
 *         "credits":[{
 *           "amount":"1.00",
 *           "account":"http://eur-ledger.example/accounts/bob"
 *         }],
 *         "execution_condition": {
 *           "message_hash": "claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==",
 *           "signer": "http://ledger.example",
 *           "type": "ed25519-sha512",
 *           "public_key": "Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c="
 *         },
 *         "expires_at": "2015-06-16T00:00:10.000Z",
 *         "state": "proposed"
 *       }]
 *    }'
 *    https://trader.example/settlements/c9377529-d7df-4aa1-ae37-ad5148612003
 *
 * @apiSuccessExample {json} 201 New Settlement Response:
 *    HTTP/1.1 201 CREATED
 *    {
 *      "id": "c9377529-d7df-4aa1-ae37-ad5148612003",
 *      "source_transfers":[{
 *        "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *        "ledger":"http://usd-ledger.example/USD",
 *        "debits":[{
 *          "amount":"1.07",
 *          "account":"http://usd-ledger.example/accounts/alice"
 *        }],
 *        "credits":[{
 *          "amount":"1.07",
 *          "account":"http://usd-ledger.example/accounts/mark"
 *        }],
 *        "execution_condition": {
 *          "message_hash": "claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==",
 *          "signer": "http://ledger.example",
 *          "type": "ed25519-sha512",
 *          "public_key": "Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c="
 *        },
 *        "expires_at": "2015-06-16T00:00:11.000Z",
 *        "state": "prepared"
 *      }],
 *      "destination_transfers":[{
 *        "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *        "ledger":"http://eur-ledger.example/EUR",
 *        "debits":[{
 *          "amount":"1.00",
 *          "account":"http://eur-ledger.example/accounts/mark"
 *        }],
 *        "credits":[{
 *          "amount":"1.00",
 *          "account":"http://eur-ledger.example/accounts/bob"
 *        }],
 *        "execution_condition": {
 *          "message_hash": "claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==",
 *          "signer": "http://ledger.example",
 *          "type": "ed25519-sha512",
 *          "public_key": "Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c="
 *        },
 *        "expires_at": "2015-06-16T00:00:10.000Z",
 *        "state": "prepared"
 *      }]
 *    }
 *
 * @apiErrorExample {json} 400 Invalid Settlement
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "id": "InvalidBodyError",
 *       "message": "JSON request body is not a valid Settlement"
 *     }
 *
 * @apiErrorExample {json} 422 Unacceptable Rate
 *     HTTP/1.1 422 Unprocessable Entity
 *     {
 *       "id": "UnacceptableRateError",
 *       "message": "Settlement rate does not match the rate currently offered"
 *     }
 */
/* eslint-enable */

exports.put = function *(id) {
  // TODO: check that this UUID hasn't been used before
  requestUtil.validateUriParameter('id', id, 'Uuid')
  let settlement = yield requestUtil.validateBody(this, 'Settlement')

  if (typeof settlement.id !== 'undefined') {
    requestUtil.assert.strictEqual(
      settlement.id,
      config.server.base_uri + this.originalUrl,
      'Settlement ID must match the one in the URL'
    )
  }

  settlement.id = id.toLowerCase()

  let isPrepared = yield Settlements.validate(settlement)
  if (isPrepared) {
    yield Settlements.settle(settlement)
  }

  // Externally we want to use a full URI ID
  settlement.id = config.server.base_uri + '/settlements/' + settlement.id

  this.status = 201
  this.body = settlement
}
