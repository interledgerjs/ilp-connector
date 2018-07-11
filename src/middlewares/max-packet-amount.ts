import * as IlpPacket from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('max-packet-amount-middleware')
import BigNumber from 'bignumber.js'
const { AmountTooLargeError } = IlpPacket.Errors
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { AccountInfo } from '../types/accounts'

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
        method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
          if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
            const parsedPacket = IlpPacket.deserializeIlpPrepare(data)

            const amount = new BigNumber(parsedPacket.amount)
            if (amount.gt(maxPacketAmount)) {
              log.debug('rejecting packet for exceeding max amount. accountId=%s maxAmount=%s actualAmount=%s', accountId, maxPacketAmount, parsedPacket.amount)
              throw new AmountTooLargeError(`packet size too large. maxAmount=${maxPacketAmount} actualAmount=${parsedPacket.amount}`, {
                receivedAmount: parsedPacket.amount,
                maximumAmount: maxPacketAmount
              })
            }
          }

          return next(data)
        }
      })
    }

  }
}
