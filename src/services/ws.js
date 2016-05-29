'use strict'

const WebSocket = require('ws')

// This allows tests to override the WebSocket implementation used
exports.WebSocket = WebSocket
