'use strict';

const Subscriber = require('../lib/subscriber').Subscriber;
const config = require('./config');

module.exports = new Subscriber(config);
