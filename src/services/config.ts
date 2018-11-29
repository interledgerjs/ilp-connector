import InvalidJsonBodyError from '../errors/invalid-json-body-error'
import { constantCase } from 'change-case'
import { Config as ConfigSchemaTyping } from '../schemas/Config'
import Ajv = require('ajv')
import { create as createLogger } from '../common/log'
const log = createLogger('config')
const schema = require('../schemas/Config.json')

const ajv = new Ajv()

const ENV_PREFIX = 'CONNECTOR_'

const BOOLEAN_VALUES = {
  '1': true,
  'true': true,
  '0': false,
  'false': false,
  '': false
}

type ConfigProfile = 'connector' | 'plugin' | 'server' | 'cluster'

export default class Config extends ConfigSchemaTyping {
  // TODO: These fields are already all defined in the config schema, however
  //   they are defined as optional and as a result, TypeScript thinks that they
  //   may not be set. However, when we construct a new Config instance, we load
  //   the defaults from the schema, so these *will* always be set. These
  //   declarations make TypeScript happy.
  public profile!: ConfigProfile
  public 'accountProviders'!: string[]
  public store!: string
  public quoteExpiry!: number
  public routeExpiry!: number
  public minMessageWindow!: number
  public maxHoldTime!: number
  public routeBroadcastInterval!: number

  protected _validate: Ajv.ValidateFunction
  protected _validateAccount: Ajv.ValidateFunction

  constructor () {
    super()

    this._validate = ajv.compile(schema)
    this._validateAccount = ajv.compile(schema.properties.accounts.additionalProperties)
  }

  loadFromEnv (env?: NodeJS.ProcessEnv) {
    if (!env) {
      env = process.env
    }

    // Copy all env vars starting with ENV_PREFIX into a set so we can check off
    // the ones we recognize and warn the user about any we don't recognize.
    const unrecognizedEnvKeys = new Set(
      Object.keys(env).filter(key => key.startsWith(ENV_PREFIX))
    )

    const config = {}
    for (let key of Object.keys(schema.properties)) {
      const envKey = ENV_PREFIX + constantCase(key)
      const envValue = env[envKey]

      unrecognizedEnvKeys.delete(envKey)

      if (typeof envValue === 'string') {
        switch (schema.properties[key].type) {
          case 'string':
            config[key] = envValue
            break
          case 'object':
          case 'array':
            try {
              config[key] = JSON.parse(envValue)
            } catch (err) {
              log.error('unable to parse config. key=%s', envKey)
            }
            break
          case 'boolean':
            config[key] = BOOLEAN_VALUES[envValue] || false
            break
          case 'integer':
          case 'number':
            config[key] = Number(envValue)
            break
          default:
            throw new TypeError('Unknown JSON schema type: ' + schema.properties[key].type)
        }
      }
    }

    for (const key of unrecognizedEnvKeys) {
      log.warn('unrecognized environment variable. key=%s', key)
    }

    this.validate(config)

    const profile = config['profile'] || 'connector' as ConfigProfile
    Object.assign(this, extractDefaultsFromSchema(profile, schema), config)
  }

  loadFromOpts (opts: object) {
    this.validate(opts)

    const profile = opts['profile'] || 'connector' as ConfigProfile
    Object.assign(this, extractDefaultsFromSchema(profile, schema), opts)
  }

  validate (config: object) {
    if (!this._validate(config)) {
      const firstError = this._validate.errors && this._validate.errors[0]
        ? this._validate.errors[0]
        : { message: 'unknown validation error', dataPath: '' }
      throw new InvalidJsonBodyError('config failed to validate. error=' + firstError.message + ' dataPath=' + firstError.dataPath, this._validate.errors || [])
    }
  }

  validateAccount (id: string, accountInfo: any) {
    if (!this._validateAccount(accountInfo)) {
      throw new InvalidJsonBodyError('account config failed to validate. id=' + id, this._validateAccount.errors || [])
    }
  }

  get (key: string) {
    return this[key]
  }
}

export const extractDefaultsFromSchema = (profile: ConfigProfile, schema: any, path = '') => {
  if (typeof schema.default !== 'undefined') {
    if (typeof schema.default === 'object' && schema.default[profile]) {
      return schema.default[profile]
    }
    return schema.default
  }
  switch (schema.type) {
    case 'object':
      const result = {}
      for (let key of Object.keys(schema.properties)) {
        // TODO, check this is actually even correct to past profile in. Add test coverage for the profile stuff
        result[key] = extractDefaultsFromSchema(profile, schema.properties[key], path + '.' + key)
      }
      return result
    default:
      throw new Error('No default found for schema path: ' + path)
  }
}
