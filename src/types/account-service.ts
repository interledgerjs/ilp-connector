import { AccountInfo } from './accounts'
import { IlpPacket, IlpPrepare } from 'ilp-packet'
import { IlpReply } from './packet'

export interface AccountService {
  registerConnectHandler (handler: () => void): void,
  deregisterConnectHandler (): void,
  registerDisconnectHandler (handler: () => void): void,
  deregisterDisconnectHandler (): void,
  registerIlpPacketHandler (handler: (data: IlpPrepare) => Promise<IlpReply>): void,
  deregisterIlpPacketHandler (): void,
  sendIlpPacket (data: IlpPrepare): Promise<IlpReply>,
  isConnected (): boolean,
  connect (): void,
  disconnect (): void,
  getInfo (): AccountInfo,
}
