import InvalidJsonBodyError from '../errors/invalid-json-body-error'

import Ajv = require('ajv')

// create validator
const ajv = new Ajv()

// add all schemas
const schemas = {
  RoutingUpdate: require('../schemas/RoutingUpdate.json'),
  Routes: require('../schemas/Routes.json'),
  IlpAddress: require('../schemas/IlpAddress.json'),
  Base64: require('../schemas/Base64.json')
}
Object.keys(schemas).forEach(name => ajv.addSchema(schemas[name], name))

export function isValid (schema: string, obj: any) {
  return ajv.validate(schema, obj)
}

export function validate (schema: string, obj: any) {
  const validatorResult = ajv.validate(schema, obj)
  if (!validatorResult) {
    // After running validate with a negative result, ajv.errors
    // is definitely defined, so we can cast it from
    // ErrorObject[] | undefined to just ErrorObject[].
    const errors = ajv.errors as Ajv.ErrorObject[]
    throw new InvalidJsonBodyError(schema + ' schema validation error: ' +
      errors[0].message, errors)
  }
}
