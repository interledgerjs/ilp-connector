var hub = require('mag-hub');
var through2 = require('through2');

// Formatters
var format = require('mag-format-message');
var colored = require('mag-colored-output');

hub
  .pipe(format())
  .pipe(through2.obj(function (chunk, enc, callback) {
    chunk.timestamp = chunk.timestamp.toISOString();
    // chunk.namespace = chunk.namespace.slice(0, 3);
    callback(null, chunk);
  }))
  .pipe(colored())
  .pipe(process.stdout);

var mag = require('mag');

module.exports = mag;
