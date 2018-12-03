import reduct = require('reduct')
import AccountProvider, { AccountProviderOptions } from '../types/account-provider'
import PluginAccount from '../accounts/plugin'
import { create as createLogger } from '../common/log'
import * as WebSocket from 'ws'
import { deserialize, serializeResponse, serializeError, TYPE_MESSAGE, base64url, BtpPacket } from 'btp-packet'
import { createHash } from 'crypto'
import * as assert from 'assert'
import ServerAccountProvider from './server'
const log = createLogger('btp-server-account-provider')

enum AccountMode {
  // Account is set using the `auth_username` BTP subprotocol.
  // A store is required in this mode.
  Username,
  // Account is set to sha256(token). The `auth_username` subprotocol is disallowed.
  HashToken,
  // Account is set to `auth_username` if available, otherwise  sha256(token) is used.
  UsernameOrHashToken
}

export function tokenToAccount (token: string): string {
  return base64url(createHash('sha256').update(token).digest())
}

export default class BtpServerAccountProvider extends ServerAccountProvider<WebSocket> implements AccountProvider {

  protected _accountMode: number
  protected _wss: WebSocket.Server | null = null

  constructor (deps: reduct.Injector, options: AccountProviderOptions) {
    super(deps, options)
    this._accountMode = AccountMode.UsernameOrHashToken
  }

  protected async _listen () {
    this._wss = new WebSocket.Server({ port: this._port })
    this._wss.on('connection', this._handleNewConnection.bind(this))
    log.debug('started btp-server account provider')
  }

  private async _create (accountId: string, socket: WebSocket) {
    if (!this._handler) throw new Error('no handler defined')

    const pluginModule = this._accountInfo.plugin as string || 'ilp-plugin-btp'
    const plugin = new (require(pluginModule))({ raw: { socket } }, {
      log: createLogger(`${this._accountInfo.plugin}[${accountId}]`),
      store: this._store.getPluginStore(accountId)
    })
    await this._handler(new PluginAccount(accountId, this._accountInfo, plugin))
  }

  protected async _handleNewConnection (wsIncoming: WebSocket) {

    let accountId: string
    let token: string
    let authPacket: BtpPacket

    wsIncoming.once('message', async (binaryAuthMessage: Buffer) => {

      try {
        authPacket = deserialize(binaryAuthMessage) as BtpPacket
        assert.strictEqual(authPacket.type, TYPE_MESSAGE, 'First message sent over BTP connection must be auth packet')
        assert(authPacket.data.protocolData.length >= 2, 'Auth packet must have auth and auth_token subprotocols')
        assert.strictEqual(authPacket.data.protocolData[0].protocolName, 'auth', 'First subprotocol must be auth')
        for (let subProtocol of authPacket.data.protocolData) {
          if (subProtocol.protocolName === 'auth_token') {
            // TODO: Do some validation on the token
            token = subProtocol.data.toString()
          } else if (subProtocol.protocolName === 'auth_username') {
            accountId = subProtocol.data.toString()
          }
        }
        assert(token, 'auth_token subprotocol is required')

        switch (this._accountMode) {
          case AccountMode.Username:
            assert(accountId, 'auth_username subprotocol is required')
            break
          case AccountMode.HashToken:
            assert(!accountId || accountId === tokenToAccount(token),
              'auth_username subprotocol is not available')
            break
        }
        // Default the account to sha256(token).
        if (!accountId) accountId = tokenToAccount(token)

        await this._create(accountId, wsIncoming)
        log.trace('got auth info. token=' + token, 'account=' + accountId)

        wsIncoming.send(serializeResponse(authPacket.requestId, []))
      } catch (err) {
        if (authPacket) {
          log.debug('not accepted error during auth. error=', err)
          const errorResponse = serializeError({
            code: 'F00',
            name: 'NotAcceptedError',
            data: err.message || err.name,
            triggeredAt: new Date().toISOString()
          }, authPacket.requestId, [])
          wsIncoming.send(errorResponse) // TODO throws error "not opened"
        }
        wsIncoming.close()
        return
      }

    })
  }

  protected async _stop () {
    if (this._wss) this._wss.close()
  }

}
