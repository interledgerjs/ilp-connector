import { EventEmitter } from 'events'

export interface ConnectOptions {

}

export interface DataHandler {
  (data: Buffer): Promise<Buffer>
}

export interface MoneyHandler {
  (amount: string): Promise<void>
}

export interface PluginInstance extends EventEmitter {
  connect (options: ConnectOptions): Promise<void>
  disconnect (): Promise<void>
  isConnected (): boolean
  sendData (data: Buffer): Promise<Buffer>
  sendMoney (amount: string): Promise<void>
  registerDataHandler (dataHandler: DataHandler): void
  deregisterDataHandler (): void
  registerMoneyHandler (moneyHandler: MoneyHandler): void
  deregisterMoneyHandler (): void
  getAdminInfo? (): Promise<object>
  sendAdminInfo? (info: object): Promise<object>
}
