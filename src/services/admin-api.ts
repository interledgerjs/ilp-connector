import reduct = require('reduct')
import Config from './config'
import RoutingTable from './routing-table'
import { Server, ServerRequest, ServerResponse } from 'http'
import { mapValues } from 'lodash'

import { create as createLogger } from '../common/log'
const log = createLogger('admin-api')

export default class AdminApi {
  private config: Config
  private routingTable: RoutingTable
  private server: Server

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.routingTable = deps(RoutingTable)
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
      switch (req.url) {
        case '/status':
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(this.getStatus()))
          break
        default:
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end('Not Found')
      }
    })
  }

  private getStatus () {
    const routingTable = this.routingTable.toJSON()
    return {
      routingTable: mapValues(routingTable, r => ({ ...r, auth: undefined, path: r.path.join(' ') }))
    }
  }
}
