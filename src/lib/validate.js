'use strict'

const Validator = require('five-bells-shared').Validator
const InvalidBodyError = require('five-bells-shared').InvalidBodyError

const validator = new Validator()
validator.loadSharedSchemas()

module.exports = function (schema, obj) {
  const validatorResult = validator.create(schema)(obj)
  if (!validatorResult.valid) {
    throw new InvalidBodyError(schema + ' schema validation error: ' + validatorResult.errors[0].message)
  }
}
