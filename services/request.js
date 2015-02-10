var co = require('co');
var validate = require('./validate');
var parse = require('co-body');
var InvalidBodyError = require('../errors/invalid-body-error');
var InvalidUriParameterError = require('../errors/invalid-uri-parameter-error');

/**
 * Validate path parameter.
 */
exports.uri = function (paramId, paramValue, schema) {
  var validationResult = validate(schema, paramValue);
  if (!validationResult.valid) {
    throw new InvalidUriParameterError(paramId + ' is not a valid ' + schema, validationResult.errors);
  }
};

/**
 * Parse the request body JSON and optionally validate it against a schema.
 */
exports.body = co.wrap(function *(ctx, schema) {
  var json = yield parse(ctx);

  if (schema) {
    var validationResult = validate(schema, json);
    if (!validationResult.valid) {
      throw new InvalidBodyError('JSON request body is not a valid '+schema, validationResult.errors);
    }
  }

  return json;
});
