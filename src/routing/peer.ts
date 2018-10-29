import Accounts from '../services/accounts'
import Config from '../services/config'
import ForwardingRoutingTable from '../services/forwarding-routing-table'
import reduct = require('reduct')
import { Relation } from './relation'
import CcpSender from './ccp-sender'
import CcpReceiver from './ccp-receiver'

export interface PeerOpts {
  deps: reduct.Injector,
  accountId: string,
  sendRoutes: boolean,
  receiveRoutes: boolean
}

export default class Peer {
  private config: Config
  private accounts: Accounts
  private accountId: string
  private ccpSender?: CcpSender
  private ccpReceiver?: CcpReceiver

  constructor ({ deps, accountId, sendRoutes, receiveRoutes }: PeerOpts) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.accountId = accountId

    const plugin = this.accounts.getPlugin(accountId)
    const forwardingRoutingTable = deps(ForwardingRoutingTable)

    if (sendRoutes) {
      this.ccpSender = new CcpSender({
        accountId,
        plugin,
        forwardingRoutingTable,
        getOwnAddress: () => this.accounts.getOwnAddress(),
        getAccountRelation: this.getAccountRelation,
        routeExpiry: this.config.routeExpiry,
        routeBroadcastInterval: this.config.routeBroadcastInterval
      })
    }

    if (receiveRoutes) {
      this.ccpReceiver = new CcpReceiver({ accountId, plugin })
    }
  }

  getAccountId () {
    return this.accountId
  }

  getReceiver () {
    return this.ccpReceiver
  }

  getSender () {
    return this.ccpSender
  }

  private getAccountRelation = (accountId: string): Relation => {
    return accountId ? this.accounts.getInfo(accountId).relation : 'local'
  }
}
