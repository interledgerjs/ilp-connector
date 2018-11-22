import { AccountInfo } from '../types/accounts'
import { GrpcTransport, MessagePayload, FrameContentType, ErrorPayload } from 'ilp-transport-grpc'
import { create as createLogger } from '../common/log'
import { AccountService } from '../types/account-service'
import { deserializeIlpPacket, serializeIlpPacket, IlpPrepare, serializeIlpPrepare, deserializeIlpPrepare } from 'ilp-packet'
import { AccountServiceBase } from './base'
import { IlpReply, deserializeIlpReply, serializeIlpReply } from '../types/packet'

const log = createLogger('grpc-account-service')

export default class GrpcAccountService extends AccountServiceBase implements AccountService {

  protected stream: GrpcTransport
  protected packetHandler?: (data: IlpPrepare) => Promise<IlpReply>

  constructor (accountId: string, accountInfo: AccountInfo, stream: GrpcTransport) {

    super(accountId, accountInfo)
    this.stream = stream

    stream.on('request', (message: MessagePayload, replyCallback: (reply: MessagePayload | ErrorPayload | Promise<MessagePayload | ErrorPayload>) => void) => {
      replyCallback(new Promise(async (respond, reject) => {
        if (this.packetHandler) {
          respond({
            protocol: 'ilp',
            contentType: FrameContentType.ApplicationOctetStream,
            payload: serializeIlpReply(await this.packetHandler(deserializeIlpPrepare(message.payload)))
          })
        } else {
          reject(new Error('No handler registered for incoming data'))
        }
      }))
    })

    // TODO - Bind to correct connect and disconnect events on the stream
    // stream.on('connect', this._streamConnect.bind(this)
    // stream.on('disconnect', this._streamDisconnect.bind(this)

  }

  async connect () {
    // TODO - This should return immediately since the connection was incoming
  }

  async disconnect () {
    // TODO
  }

  isConnected () {
    return true // hard code to true for now
  }

  async sendIlpPacket (packet: IlpPrepare): Promise<IlpReply> {
    return new Promise<IlpReply>(async (resolve, reject) => {
      try {
        const response = await this.stream.request({
          protocol: 'ilp',
          contentType: FrameContentType.ApplicationOctetStream,
          payload: serializeIlpPrepare(packet)
        })
        resolve(deserializeIlpReply(response.payload))
      } catch (e) {
        reject(e)
      }
    })
  }
  registerIlpPacketHandler (handler: (data: IlpPrepare) => Promise<IlpReply>) {
    this.packetHandler = handler
  }

  deregisterIlpPacketHandler () {
    this.packetHandler = undefined
  }

  getInfo () {
    return this.info
  }

  private _streamConnect () {
    if (this.connectHandler) this.connectHandler()
  }

  private _streamDisconnect () {
    if (this.disconnectHandler) this.disconnectHandler()
  }
}
