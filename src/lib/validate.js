'use strict'

const Validator = require('five-bells-shared').Validator
const InvalidBodyError = require('five-bells-shared').InvalidBodyError
const path = require('path')

const validator = new Validator()
validator.loadSharedSchemas()
validator.loadSchemasFromDirectory(path.join(__dirname, '../../schemas'))

function isValid (schema, obj) {
  return validator.create(schema)(obj)
}

function validate (schema, obj) {
  const validatorResult = validator.create(schema)(obj)
  if (!validatorResult.valid) {
    throw new InvalidBodyError(schema + ' schema validation error: ' + validatorResult.errors[0].message)
  }
}

module.exports = {
  validate,
  isValid
}
