'use strict';

module.exports = validate;

var fs = require('fs');
var path = require('path');

var validator = require('skeemas')();

var baseDir = path.join(__dirname, '/../schemas');

fs.readdirSync(baseDir)
  .filter(function(fileName) {
    return /^[\w\s]+\.json$/.test(fileName);
  })
  .forEach(function(fileName) {
    try {
      var schema = JSON.parse(fs.readFileSync(path.join(baseDir, fileName), 'utf8'));
      validator.addRef(fileName, schema);
    } catch (e) {
      throw new Error('Failed to parse schema: ' + fileName);
    }
  });

function validate(schemaId, json) {
  return validator.validate(json, schemaId+'.json');
}
