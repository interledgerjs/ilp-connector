var co = require('co');
var validate = require('../services/validate');
var parse = require('co-body');
var assert = require('assert');
var InvalidBodyError = require('../errors/invalid-body-error');
var InvalidUriParameterError = require('../errors/invalid-uri-parameter-error');

/**
 * Validate path parameter.
 */
exports.validateUriParameter = function (paramId, paramValue, schema) {
  var validationResult = validate(schema, paramValue);
  if (!validationResult.valid) {
    throw new InvalidUriParameterError(paramId + ' is not a valid ' + schema, validationResult.errors);
  }
};

/**
 * Parse the request body JSON and optionally validate it against a schema.
 */
exports.validateBody = co.wrap(function *(ctx, schema) {
  var json = yield parse(ctx);

  if (schema) {
    var validationResult = validate(schema, json);
    if (!validationResult.valid) {
      throw new InvalidBodyError('JSON request body is not a valid '+schema, validationResult.errors);
    }
  }

  return json;
});

exports.assert = function (value, message) {
  try {
    assert(value, message);
  } catch (err) {
    throw new InvalidBodyError(err.message);
  }
};

['equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'strictEqual', 'notStrictEqual'].forEach(function (method) {
  exports.assert[method] = function (actual, expected, message) {
    try {
      assert[method](actual, expected, message);
    } catch (err) {
      throw new InvalidBodyError(err.message);
    }
  }
});
