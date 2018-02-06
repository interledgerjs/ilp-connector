import reduct = require('reduct')
import Config from './config'
import RoutingTable from './routing-table'
import RouteBroadcaster from './route-broadcaster'
import { formatRoutingTableAsJson } from '../routing/utils'
import { Server, ServerRequest, ServerResponse } from 'http'

import { create as createLogger } from '../common/log'
const log = createLogger('admin-api')

export default class AdminApi {
  private config: Config
  private routingTable: RoutingTable
  private routeBroadcaster: RouteBroadcaster

  private server?: Server

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.routingTable = deps(RoutingTable)
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  listen () {
    const {
      adminApi = false,
      adminApiHost = '127.0.0.1',
      adminApiPort = 7780
    } = this.config

    log.info('listen called')

    if (adminApi) {
      log.info('admin api listening. host=%s port=%s', adminApiHost, adminApiPort)
      this.server = new Server()
      this.server.listen(adminApiPort, adminApiHost)
      this.server.on('request', this.handleRequest.bind(this))
    }
  }

  private handleRequest (req: ServerRequest, res: ServerResponse) {
    req.setEncoding('utf8')

    let body = ''
    req.on('data', data => body += data)
    req.on('end', () => {
      try {
        switch (req.url) {
          case '/status':
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(this.getStatus()))
            break
          case '/routing':
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(this.getRoutingStatus()))
            break
          default:
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain')
            res.end('Not Found')
        }
      } catch (e) {
        let err = e
        if (!e || typeof e !== 'object') {
          err = new Error('non-object thrown. error=' + e)
        }

        log.warn('error in admin api request handler. error=%s', err.stack ? err.stack : err)
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain')
        res.end(String(err))
      }
    })
  }

  private getStatus () {
    return {
      localRoutingTable: formatRoutingTableAsJson(this.routingTable)
    }
  }

  private getRoutingStatus () {
    return this.routeBroadcaster.getStatus()
  }
}
