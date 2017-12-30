'use strict'

const logger = require('../common/log')
const log = logger.create('config')
const InvalidJsonBodyError = require('../errors/invalid-json-body-error')
const { constantCase } = require('change-case')
const schema = require('../schemas/Config.json')
const {
  extractDefaultsFromSchema
} = require('../lib/utils')
const Ajv = require('ajv')

const ajv = new Ajv()

const ENV_PREFIX = 'CONNECTOR_'

const BOOLEAN_VALUES = {
  '1': true,
  'true': true,
  '0': false,
  'false': false,
  '': false
}

class Config {
  constructor () {
    this.loadDefaults()

    this._validate = ajv.compile(schema)
    this._validateAccount = ajv.compile(schema.properties.accounts.additionalProperties)
  }

  loadDefaults () {
    Object.assign(this, extractDefaultsFromSchema(schema))
  }

  loadFromEnv (env) {
    if (!env) {
      env = process.env
    }

    for (let key of Object.keys(schema.properties)) {
      const envKey = ENV_PREFIX + constantCase(key)

      if (typeof env[envKey] === 'string') {
        switch (schema.properties[key].type) {
          case 'string':
            this[key] = env[envKey]
            break
          case 'object':
          case 'array':
            try {
              this[key] = JSON.parse(env[envKey])
            } catch (err) {
              log.warn('unable to parse config. key=%s', envKey)
            }
            break
          case 'boolean':
            this[key] = BOOLEAN_VALUES[env[envKey]] || false
            break
          case 'number':
            this[key] = Number(env[envKey])
            break
          default:
            throw new TypeError('Unknown JSON schema type: ' + schema.properties[key].type)
        }
      }
    }
  }

  validate () {
    if (!this._validate(this)) {
      const firstError = this._validate.errors[0]
      throw new InvalidJsonBodyError('config failed to validate. error=' + firstError.message + ' dataPath=' + firstError.dataPath, this._validate.errors)
    }
  }

  validateAccount (id, accountInfo) {
    if (!this._validateAccount(accountInfo)) {
      throw new InvalidJsonBodyError('account config failed to validate. id=' + id, this._validateAccount.errors)
    }
  }

  get (key) {
    return this[key]
  }
}

module.exports = Config
