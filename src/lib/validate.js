'use strict'

const InvalidJsonBodyError = require('../errors/invalid-json-body-error')

const schemas = require('ilp-schemas')
const Ajv = require('ajv')

// create validator
const ajv = new Ajv()

ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'))

// add all schemas
Object.keys(schemas).forEach(name => ajv.addSchema(schemas[name], name))

function isValid (schema, obj) {
  return ajv.validate(schema, obj)
}

function validate (schema, obj) {
  const validatorResult = ajv.validate(schema, obj)
  if (!validatorResult) {
    throw new InvalidJsonBodyError(schema + ' schema validation error: ' +
      ajv.errors[0].message, ajv.errors)
  }
}

module.exports = {
  validate,
  isValid
}
