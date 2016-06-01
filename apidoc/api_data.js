define({ "api": [
  {
    "type": "get",
    "url": "/pairs",
    "title": "Get currency pairs",
    "name": "GetPairs",
    "group": "Currency_Pairs",
    "description": "<p>Get the currency pairs for which this connector can provide quotes and facilitate payments.</p>",
    "success": {
      "examples": [
        {
          "title": "Get Currency Pairs",
          "content": "HTTP/1.1 200 OK\n  [\n    {\n      \"source_asset\": \"USD\",\n      \"source_ledger\": \"https://usd-ledger.example/USD\",\n      \"destination_asset\": \"EUR\",\n      \"destination_ledger\": \"https://eur-ledger.example/EUR\"\n    },\n    {\n      \"source_asset\": \"EUR\",\n      \"source_ledger\": \"https://eur-ledger.example/EUR\",\n      \"destination_asset\": \"USD\",\n      \"destination_ledger\": \"https://usd-ledger.example/USD\"\n    },\n    {\n      \"source_asset\": \"JPY\",\n      \"source_ledger\": \"https://jpy-ledger.example/JPY\",\n      \"destination_asset\": \"USD\",\n      \"destination_ledger\": \"https://usd-ledger.example/USD\"\n    }]",
          "type": "json"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "src/controllers/pairs.js",
    "groupTitle": "Currency_Pairs"
  },
  {
    "type": "get",
    "url": "/",
    "title": "Get the server metadata",
    "name": "GetMetadata",
    "group": "Metadata",
    "version": "1.0.0",
    "description": "<p>This endpoint will return server metadata.</p>",
    "filename": "src/controllers/metadata.js",
    "groupTitle": "Metadata"
  },
  {
    "type": "post",
    "url": "/notifications",
    "title": "Receive ledger notifications",
    "name": "Notifications",
    "group": "Notifications",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "URI",
            "optional": false,
            "field": "id",
            "description": "<p>Subscription URI that created this notification</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "event",
            "description": "<p>EventId of the event that triggered the notification</p>"
          },
          {
            "group": "Parameter",
            "type": "Transfer",
            "optional": false,
            "field": "resource",
            "description": "<p>The resource described by the notification</p>"
          }
        ]
      }
    },
    "description": "<p>This is the endpoint where the connector will receive notifications from the ledgers about transfers affecting their accounts.</p>",
    "examples": [
      {
        "title": "Send Notification:",
        "content": "curl -X POST -H \"Content-Type: application/json\" -d\n  '{\n    \"id\": \"http://eur-ledger.example/EUR/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb30d\",\n    \"event\": \"transfer.update\",\n    \"resource\": {\n      \"id\": \"http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9\",\n      \"ledger\":\"http://eur-ledger.example/EUR\",\n      \"debits\":[{\n        \"amount\":\"1.00\",\n        \"account\":\"mark\"\n      }],\n      \"credits\":[{\n        \"amount\":\"1.00\",\n        \"account\":\"bob\"\n      }],\n      \"execution_condition\": {\n        \"message_hash\": \"claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==\",\n        \"signer\": \"http://ledger.example\",\n        \"type\": \"ed25519-sha512\",\n        \"public_key\": \"Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c=\"\n      },\n      \"state\": \"executed\"\n    },\n   \"related_resources\": {\n      \"execution_condition_fulfillment\": {\n        \"type\": \"ed25519-sha512\",\n        \"signature\": \"g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA==\"\n      }\n   },\n   \"signature\": {\n    \"algorithm\": \"PS256\",\n    \"publicKey\": {\n      \"type\": \"RSA\",\n      \"e\": \"NjU1Mzc=\",\n      \"n\": \"Njc1NTkwOTcxMTE2NTEwMTIyODY4MzE0NjkwMzkxODI3NTAyMjQ4MzA1NzQ3NzA0NTkxNDg3MzA4MzI4MzQ3ODEzODgyNTgwMTIzMDU1NzE4OTM1MjAyMTY2Njk0OTIwODcxMDkzMzcwNjA2MDc5NTU3Mzg2ODg1MjI3MTY0MTE2NTkwMDYxNTkzMDU0NTQyMDgyMzU0Nzc5NjczMzExODExMzMwNzkwNjI0NTMxNjIxMjg2OTg0MTE3NDgwNzM3MzUwNzUwNjM4Mzg0MjYzNDMwMjczNDQ0OTIwNDgyODY5MDc2MTgzNDEwOTc1NTU2NDM4MzYxNTg4MTIyNzIxNzU0NzU2ODcwNDAyMTI3OTcxNzIxMTc2MjkxMTE2MzEwNzIxMzEyOTExMTgwNTMyNDE5ODE4NzM0NjYwNTE3MDc0MDIxNDE4Nzc3Mjc5NjcwNDkyNjc1NDA5NzU1NTk2MzUxOTAwOTAwMTA5NDMyMzAzNzg2NjExMTA3NTExNjk1NDU2MzUwNzI5NDQ5NTE4NzkxNTQ1NTAxMjkzNDcwNzExNzI3MzExNDgwMDY3Njk2MDQ3MDgwNDAwMzE5Njk2MzYxNjk3NTY0MTg2NzIxNDI3NDMwNDIyMDk3MzExNjgxNjQxNDkyNjM2Nzk1ODQxNDE5MTY5MjM1NzM1MTUzNDA2MDc1MDk1OTk3NTc2MDA4NDE3NTEyMjgzMjY5MTI3NDU1OTU4OTM3MTk5MDI1MDMxNTM4NTIyMzE5MTg5MTMyOTM3NDgyNzg2NzE3MzAxMDM0MjkyMDM2NTEzMzQ2NDU2OTE4MzcwOTk1NzQyMDM5NzAwOTkyNDM3NzY5OTM1NDQ2OTc1OTIxNDE1NjQyMTU2NzIxMzkzMTAwMjQyMDkxMTk1NTIyMjQ5ODc3NTk3NzY2MjE3NzE2MDc4MzgxNzY1MjYxMDIyNjY4NjEwNzE0NTY1MTk5ODkzODcxMTU0NDQ5NTQzMzk4NjQzNTA0Njc3NjIwNjEwOTY5ODkwNzE2MDk0MTM5NjcxOTQ1MjY2ODEzNzY1MTkyOTc4Mjc0NjcwMTk2Njc5NDM5MTM4MjgxMTk5MTc5Nzg5NjIzMzU5ODk0MTExOTEwOTAxNTYyMTg1NjE1ODcxMzQ5NjQzOTA5MjcwMDg3ODM0MzUxNTg5NTA3MjgxOTc5NzE4MzQxMzkxNzc0NjE0NzI1NzI3MjQ0ODQ0MDM0NTUyNzg2ODQxNzM3MDQ5NDc0ODU4NTY3OTAxOTY4NTcyMjcxMTY2NDk5OTgzNjI0MjkyODcwMjM5ODY0Njk4ODU0ODY3ODAyMzk5NTUxNTE3MDcyOTI0MDk1OTUzMjY4MzEzNzk4Nzg5MDEyODUzNjc4OTU5NjE1MTg1NTUxNzQwMTU0MzYxODc3OTM3NjkxMzg4MzU0MDc1Nzk0ODA4OTQxOTEwNzkxMDA3Njc2MzQzNTcyODUwNjY4NTM3MjU2NjU5MDU1Mzk2ODE5ODc0OTk0NDA2NzMzNzc0NTEwMjE0MzYyMDYxNjc0MDc4OTI2NTEzODYwOTczMjEzNTY2OTQ1MDYwNjk5MjEyNTg5Njk2Njg2NjA4NjMwODYxOTA3OTQ2NTUyNzQzNzM5OTUyMDkzNTQxMzUxNjcx\"\n    },\n    \"value\": \"lrtuXtNX7O1EkrG2Kc6PypOioYsZevG8QNVKTSbAw1_8gnmTBCSETf-5snTa90KKT4XLBO9KgBruo0f-xqphW4p4Y21c00OsMxTlMRWRkd-yJv7Oi0d3-MA8cixSgPg6djIR62oEPxEnnIVNv8cZ3Euq0fsRsNS4Pn6Tjmpl1jz_y-8uk_KuoAEP1QXVGnHEsp62hI2-8WjReIYz2wZMW8g7wbrCH92tSLqlj8t6Kh_9I6OMwTZgJ3W92tfuy4c-Powoo2ZQfeI3-Kj3jBbew4m-sKy1dyVOskdaIz4Rbl0enVXlBbxeeMj8KpJPMS9IToBLQXO7JzcEygywxHT72NWUgVPmJpRJ0xkSBDyu6sBx7Hg_vsid6Kn5A91dDOTribX99IstXBWEcD8uB8y_d02VlYPlkEYRPiMK9B7eIo62BkkMAQZYd2R9oelGZbVvy_Kr5zLxFhNr0wPdgc9slkSfGmHrWvB6WZp0r8ay33qEloiY_mMHBxTavLdqz2-WBH92vGGqxP3lH5LpNR1l1Cst8cABmJ82u9fpbjGZfD7DE3jKySZNL4ZSdhbjmXjlBmPfIjO_oQYce4IZKaLxm1tD7HeO5f-QY2lzzEHFxxw4783JXyyRFg0F4WOIdhysR7VJlUOMpa5LH8yBHQWlrTgq6iI6jUjhxwhhVPN3xXU\"\n   }\n  }'\nhttps://connector.example/notifications",
        "type": "shell"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "Notification Accepted:",
          "content": "HTTP/1.1 200 OK",
          "type": "json"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "src/controllers/notifications.js",
    "groupTitle": "Notifications"
  },
  {
    "type": "get",
    "url": "/quote",
    "title": "Get quote",
    "name": "Quote",
    "group": "Quote",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "URI",
            "optional": false,
            "field": "source_ledger",
            "description": "<p>Ledger where the transfer crediting the connector's account will take place</p>"
          },
          {
            "group": "Parameter",
            "type": "URI",
            "optional": false,
            "field": "destination_ledger",
            "description": "<p>Ledger where the transfer debiting the connector's account will take place</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "source_amount",
            "defaultValue": "(Set by connector if destination_amount is￿   specified)",
            "description": "<p>Fixed amount to be debited from sender's account (should not be specified if destination_amount is)</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "destination_amount",
            "defaultValue": "(Set by connector if source_amount is￿   specified)",
            "description": "<p>Fixed amount to be credited to receiver's account (should not be specified if source_amount is)</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "destination_expiry_duration",
            "defaultValue": "(Maximum allowed if￿   unspecified)",
            "description": "<p>Number of milliseconds between when the source transfer is proposed and when it expires</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "source_expiry_duration",
            "defaultValue": "(Minimum allowed based on￿   destination_expiry_duration)",
            "description": "<p>Number of milliseconds between when the destination transfer is proposed and when it expires</p>"
          }
        ]
      }
    },
    "description": "<p>Get a quote from the connector based on either a fixed source or fixed destination amount.</p>",
    "examples": [
      {
        "title": "Fixed Source Amount:",
        "content": "curl https://connector.example? \\\n  source_amount=100.25 \\\n  &source_ledger=https://eur-ledger.example/EUR \\\n  &destination_ledger=https://usd-ledger.example/USD \\\n  &source_expiry_duration=6 \\\n  &destination_expiry_duration=5 \\",
        "type": "shell"
      },
      {
        "title": "Fixed Destination Amount:",
        "content": "curl https://connector.example? \\\n  destination_amount=105.71 \\\n  &source_ledger=https://eur-ledger.example/EUR \\\n  &destination_ledger=https://usd-ledger.example/USD \\\n  &source_expiry_duration=6000 \\\n  &destination_expiry_duration=5000 \\",
        "type": "shell"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "200 Quote Response:",
          "content": "HTTP/1.1 200 OK\n  {\n    \"source_connector_account\": \"mark\",\n    \"source_ledger\": \"http://eur-ledger.example/EUR\",\n    \"source_amount\": \"100.25\",\n    \"source_expiry_duration\": \"6000\",\n    \"destination_ledger\": \"http://usd-ledger.example/USD\",\n    \"destination_amount\": \"105.71\",\n    \"destination_expiry_duration\": \"5000\"\n  }",
          "type": "json"
        },
        {
          "title": "200 Quote Response:",
          "content": "HTTP/1.1 200 OK\n  {\n    \"source_connector_account\": \"mark\",\n    \"source_ledger\": \"http://eur-ledger.example/EUR\",\n    \"source_amount\": \"100.25\",\n    \"source_expiry_duration\": \"6000\",\n    \"destination_ledger\": \"http://usd-ledger.example/USD\",\n    \"destination_amount\": \"105.71\",\n    \"destination_expiry_duration\": \"5000\"\n  }",
          "type": "json"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "src/controllers/quote.js",
    "groupTitle": "Quote",
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "UnacceptableExpiryError",
            "description": "<p>Insufficient time between the destination and source expiry duration to ensure transfers can be executed in time.</p>"
          },
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "AssetsNotTradedError",
            "description": "<p>The connector does not facilitate payments between the given currency pair.</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "UnacceptableExpiryError",
          "content": "HTTP/1.1 422 Bad Request\n{\n  \"id\": \"UnacceptableExpiryError\",\n  \"message\": \"The difference between the destination expiry duration and the source expiry duration is insufficient to ensure that we can execute the source transfers.\"\n}",
          "type": "json"
        },
        {
          "title": "AssetsNotTradedError",
          "content": "HTTP/1.1 422 Bad Request\n{\n  \"id\": \"AssetsNotTradedError\",\n  \"message\": \"Error description here.\"\n}",
          "type": "json"
        }
      ]
    }
  }
] });
