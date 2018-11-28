import { create as createLogger } from '../common/log'
import BigNumber from 'bignumber.js'
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { IlpPrepare, Errors as IlpPacketErrors, IlpReply } from 'ilp-packet'
import { AccountInfo } from '../types/accounts'
const { AmountTooLargeError } = IlpPacketErrors
const log = createLogger('max-packet-amount-middleware')

export default class MaxPacketAmountMiddleware implements Middleware {
  private getInfo: (accountId: string) => AccountInfo

  constructor (opts: {}, { getInfo }: MiddlewareServices) {
    this.getInfo = getInfo
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)

    if (!accountInfo) {
      throw new Error('account info unavailable. accountId=' + accountId)
    }

    if (accountInfo.maxPacketAmount) {
      const maxPacketAmount = accountInfo.maxPacketAmount
      pipelines.incomingData.insertLast({
        name: 'maxPacketAmount',
        method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {

          const amount = new BigNumber(packet.amount)
          if (amount.gt(maxPacketAmount)) {
            log.debug('rejecting packet for exceeding max amount. accountId=%s maxAmount=%s actualAmount=%s', accountId, maxPacketAmount, packet.amount)
            throw new AmountTooLargeError(`packet size too large. maxAmount=${maxPacketAmount} actualAmount=${packet.amount}`, {
              receivedAmount: packet.amount,
              maximumAmount: maxPacketAmount
            })
          }
          return next(packet)
        }
      })
    }

  }
}
