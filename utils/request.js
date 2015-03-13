'use strict';

const co = require('co');
const validate = require('../services/validate');
const parse = require('co-body');
const assert = require('assert');
const InvalidBodyError = require('../errors/invalid-body-error');
const InvalidUriParameterError =
  require('../errors/invalid-uri-parameter-error');

/**
 * Validate path parameter.
 *
 * @param {String} paramId Name of URL parameter.
 * @param {String} paramValue Value of URL parameter.
 * @param {String} schema Name of JSON schema.
 *
 * @returns {void}
 */
exports.validateUriParameter = function (paramId, paramValue, schema) {
  let validationResult = validate(schema, paramValue);
  if (!validationResult.valid) {
    throw new InvalidUriParameterError(paramId + ' is not a valid ' + schema,
      validationResult.errors);
  }
};

/**
 * Parse the request body JSON and optionally validate it against a schema.
 *
 * @param {Object} ctx Koa context.
 * @param {String} schema Name of JSON schema.
 *
 * @returns {Object} Parsed JSON body
 */
exports.validateBody = co.wrap(function *(ctx, schema) {
  let json = yield parse(ctx);

  if (schema) {
    let validationResult = validate(schema, json);
    if (!validationResult.valid) {
      throw new InvalidBodyError('JSON request body is not a valid ' + schema,
        validationResult.errors);
    }
  }

  return json;
});

/**
 * Get the base URI.
 *
 * @param {Object} ctx Koa context.
 *
 * @returns {String} Base URI.
 */
exports.getBaseUri = function (ctx) {
  return 'http://' + ctx.request.header.host;
};

exports.assert = function (value, message) {
  try {
    assert(value, message);
  } catch (err) {
    throw new InvalidBodyError(err.message);
  }
};

['equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'strictEqual',
 'notStrictEqual'].forEach(function (method) {
  exports.assert[method] = function (actual, expected, message) {
    try {
      assert[method](actual, expected, message);
    } catch (err) {
      throw new InvalidBodyError(err.message);
    }
  };
});
