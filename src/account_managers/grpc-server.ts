import reduct = require('reduct')
import Config from '../services/config'
import { GrpcTransport, GrpcTransportServer } from 'ilp-transport-grpc'
import { AccountManagerInstance } from '../types/account-manager'
import { EventEmitter } from 'events'
import { create as createLogger } from '../common/log'
import { AccountService } from '../types/account-service'
import GrpcAccountService from '../account_services/grpc'

const log = createLogger('grpc-account-manager')

export default class GrpcAccountManager extends EventEmitter implements AccountManagerInstance {
  protected config: Config
  protected accountServices: Map<string, AccountService>
  protected newAccountHandler?: (accountId: string, accountService: AccountService) => Promise<void>
  protected removeAccountHandler?: (accountId: string) => void

  constructor (deps: reduct.Injector) {

    super()
    this.config = deps(Config)
    this.accountServices = new Map()
  }

  exists (accountId: string) {
    return this.accountServices.has(accountId)
  }

  registerNewAccountHandler (handler: (accountId: string, accountService: AccountService) => Promise<void>) {

    if (this.newAccountHandler) {
      log.error('New account handler already exists')
      throw new Error('New account handler already exists')
    }

    log.info('registering new account handler.')

    this.newAccountHandler = handler

  }

  deregisterNewAccountHandler () {

    log.info('deregistering new account handler.')

    this.newAccountHandler = undefined

  }

  registerRemoveAccountHandler (handler: (accountId: string) => void) {

    if (this.removeAccountHandler) {
      log.error('Remove account handler already exists')
      throw new Error('Remove account handler already exists')
    }

    log.info('registering remove account handler.')

    this.removeAccountHandler = handler

  }

  deregisterRemoveAccountHandler () {

    log.info('account manager deregistering removing plugin handler.')

    this.removeAccountHandler = undefined

  }

  async add (accountId: string, accountInfo: any, stream: GrpcTransport) {

    const accountService = new GrpcAccountService(accountId, accountInfo, stream)
    this.accountServices.set(accountId, accountService)

    if (this.newAccountHandler) await this.newAccountHandler(accountId, this.accountServices.get(accountId) as AccountService)

  }

  remove (accountId: string) {

    const accountService = this.getAccountService(accountId)

    accountService.disconnect()

    if (this.removeAccountHandler) this.removeAccountHandler(accountId)

    this.accountServices.delete(accountId)
  }

  async startup () {

    const {
      grpcServerHost = '127.0.0.1',
      grpcServerPort = 5506
    } = this.config

    const server = new GrpcTransportServer({}, {})

    server.on('connection', (stream: GrpcTransport) => {

      const { accountId, accountInfo } = stream

      this.add(accountId || '', accountInfo, stream)

      stream.on('error', (error) => console.log(error))

      stream.on('cancelled', () => {
        this.remove(accountId || '')
      })

    })

    server.on('listening', () => {
      log.info('grpc server listening. host=%s port=%s', grpcServerHost, grpcServerPort)
    })

    await server.listen({
      host: grpcServerHost,
      port: grpcServerPort
    })

  }

  shutdown () {

    log.info('shutting down')

  }

  getAccountService (accountId: string): AccountService {
    const accountService = this.accountServices.get(accountId)
    if (!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

  getAccounts () {
    return this.accountServices
  }

}
