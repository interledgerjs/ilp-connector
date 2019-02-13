'use strict'

class MockIlpEndpoint {

  constructor () {
    
  }
  
  async request (request, sentCallback) {
    const handler = this.handlerProvider(request)
    const reply = await handler(request)
    
    if(sentCallback) sentCallback()

    return reply
  }

}

module.exports = MockIlpEndpoint