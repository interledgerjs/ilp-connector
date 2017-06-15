const connector = require('..')
const app = require('koa')()
const router = require('koa-router')()
const parser = require('koa-bodyparser')
const port = 8080

router.post('/rpc', function * () {
  const method = this.query.method
  const prefix = this.query.prefix

  if (!method) {
    this.status = 422
    this.body = JSON.stringify({ message: 'missing method' })
    return
  }

  if (!prefix) {
    this.status = 422
    this.body = JSON.stringify({ message: 'missing prefix' })
    return
  }

  let plugin
  try {
    plugin = connector.getPlugin(prefix)
  } catch (e) {
    this.status = 404
    this.body = JSON.stringify({ message: 'no plugin with prefix ' + prefix })
    return
  }

  this.body = yield plugin.receive(method, this.request.body)
})

app
  .use(parser())
  .use(router.routes())
  .use(router.allowedMethods())
  .listen(port)

connector
  .listen()
