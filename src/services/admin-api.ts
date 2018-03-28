import reduct = require('reduct')
import { mapValues as pluck } from 'lodash'
import Accounts from './accounts'
import Config from './config'
import MiddlewareManager from './middleware-manager'
import RoutingTable from './routing-table'
import RouteBroadcaster from './route-broadcaster'
import Stats from './stats'
import RateBackend from './rate-backend'
import { formatRoutingTableAsJson } from '../routing/utils'
import { Server, ServerRequest, ServerResponse } from 'http'

import { create as createLogger } from '../common/log'
const log = createLogger('admin-api')

export default class AdminApi {
  private accounts: Accounts
  private config: Config
  private middlewareManager: MiddlewareManager
  private routingTable: RoutingTable
  private routeBroadcaster: RouteBroadcaster
  private rateBackend: RateBackend
  private stats: Stats

  private server?: Server

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
    this.config = deps(Config)
    this.middlewareManager = deps(MiddlewareManager)
    this.routingTable = deps(RoutingTable)
    this.routeBroadcaster = deps(RouteBroadcaster)
    this.rateBackend = deps(RateBackend)
    this.stats = deps(Stats)
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
      this.server.on('request', (req, res) => {
        this.handleRequest(req, res).catch((e) => {
          let err = e
          if (!e || typeof e !== 'object') {
            err = new Error('non-object thrown. error=' + e)
          }

          log.warn('error in admin api request handler. error=%s', err.stack ? err.stack : err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain')
          res.end(String(err))
        })
      })
    }
  }

  private async handleRequest (req: ServerRequest, res: ServerResponse) {
    req.setEncoding('utf8')
    let body = ''
    await new Promise((resolve, reject) => {
      req.on('data', data => body += data)
      req.once('end', resolve)
      req.once('error', reject)
    })

    let status
    switch (req.url) {
      case '/status':
        status = this.getStatus()
        break
      case '/routing':
        status = this.getRoutingStatus()
        break
      case '/accounts':
        status = this.getAccountStatus()
        break
      case '/balance':
        status = this.getBalanceStatus()
        break
      case '/rates':
        status = await this.getBackendStatus()
        break
      case '/stats':
        status = this.getStats()
        break
      default:
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain')
        res.end('Not Found')
        return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(status))
  }

  private getStatus () {
    return {
      balances: pluck(this.getBalanceStatus()['accounts'], 'balance'),
      connected: pluck(this.getAccountStatus()['accounts'], 'connected'),
      localRoutingTable: formatRoutingTableAsJson(this.routingTable)
    }
  }

  private getRoutingStatus () {
    return this.routeBroadcaster.getStatus()
  }

  private getAccountStatus () {
    return this.accounts.getStatus()
  }

  private getBalanceStatus () {
    return this.middlewareManager.getStatus('balance')
  }

  private getBackendStatus (): Promise<{ [s: string]: any }> {
    return this.rateBackend.getStatus()
  }

  private getStats () {
    return this.stats.getStatus()
  }
}
