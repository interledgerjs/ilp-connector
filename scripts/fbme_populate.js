'use strict'

const zmq = require('zmq')

const sock = zmq.socket('pair')

sock.connect('tcp://localhost:36002')

const send = (message) => {
  console.log('>>> ' + message)
  sock.send(message)
}

sock.on('message', (message) => {
  console.log('<<< ' + message)
})

send('8=4.4|35=L|20006=D|54=1|1=1|11=0|44=1.1|151=1000|39=A|48=0')
