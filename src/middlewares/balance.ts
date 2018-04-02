import { create as createLogger } from '../common/log'
const log = createLogger('balance-middleware')
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { AccountInfo } from '../types/accounts'
import BigNumber from 'bignumber.js'
import * as IlpPacket from 'ilp-packet'
const { InsufficientLiquidityError } = IlpPacket.Errors

interface BalanceOpts {
  initialBalance?: BigNumber
  minimum?: BigNumber
  maximum?: BigNumber
}

class Balance {
  private balance: BigNumber
  private minimum: BigNumber
  private maximum: BigNumber

  constructor ({
    initialBalance = new BigNumber(0),
    minimum = new BigNumber(0),
    maximum = new BigNumber(Infinity)
  }: BalanceOpts) {
    this.balance = initialBalance
    this.minimum = minimum
    this.maximum = maximum
  }

  add (amount: BigNumber | string | number) {
    const newBalance = this.balance.plus(amount)

    if (newBalance.gt(this.maximum)) {
      log.info('rejected balance update. oldBalance=%s newBalance=%s amount=%s', this.balance, newBalance, amount)
      throw new InsufficientLiquidityError('exceeded maximum balance.')
    }

    this.balance = newBalance
  }

  subtract (amount: BigNumber | string | number) {
    const newBalance = this.balance.minus(amount)

    if (newBalance.lt(this.minimum)) {
      log.info('rejected balance update. oldBalance=%s newBalance=%s amount=%s', this.balance, newBalance, amount)
      throw new Error(`insufficient funds. oldBalance=${this.balance} proposedBalance=${newBalance}`)
    }

    this.balance = newBalance
  }

  getValue () {
    return this.balance
  }

  toJSON () {
    return {
      balance: this.balance.toString(),
      minimum: this.minimum.toString(),
      maximum: this.maximum.toString()
    }
  }
}

export default class BalanceMiddleware implements Middleware {
  private getInfo: (accountId: string) => AccountInfo
  private sendMoney: (amount: string, accountId: string) => Promise<void>
  private balances: Map<string, Balance> = new Map()

  constructor (opts: {}, { getInfo, sendMoney }: MiddlewareServices) {
    this.getInfo = getInfo
    this.sendMoney = sendMoney
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)
    if (!accountInfo) {
      throw new Error('could not load info for account. accountId=' + accountId)
    }

    if (accountInfo.balance) {
      const {
        minimum = '-Infinity',
        maximum,
        settleThreshold,
        settleTo = '0'
      } = accountInfo.balance

      let balance = new Balance({
        minimum: new BigNumber(minimum),
        maximum: new BigNumber(maximum)
      })
      this.balances.set(accountId, balance)

      const bnSettleThreshold = settleThreshold ? new BigNumber(settleThreshold) : undefined
      const bnSettleTo = new BigNumber(settleTo)

      log.debug('initializing balance for account. accountId=%s minimumBalance=%s maximumBalance=%s', accountId, minimum, maximum)

      const maybeSettle = (threshold: BigNumber | undefined, settleTo: BigNumber, balance: Balance) => {
        const settle =
          threshold &&
          threshold.gt(balance.getValue())

        if (settle) {
          const settleAmount = settleTo.minus(balance.getValue())

          log.debug('settlement triggered. accountId=%s balance=%s settleAmount=%s', accountId, balance.getValue(), settleAmount)

          this.sendMoney(settleAmount.toString(), accountId)
            .catch(e => {
              let err = e
              if (!err || typeof err !== 'object') {
                err = new Error('Non-object thrown: ' + e)
              }

              log.error('error occurred during settlement. accountId=%s settleAmount=%s errInfo=%s', accountId, settleAmount, err.stack ? err.stack : err)
            })
        }
      }

      pipelines.startup.insertLast({
        name: 'balance',
        method: async (dummy: void, next: MiddlewareCallback<void, void>) => {
          // When starting up, check if we need to pre-fund / settle
          maybeSettle(bnSettleThreshold, bnSettleTo, balance)

          return next(dummy)
        }
      })

      pipelines.incomingData.insertLast({
        name: 'balance',
        method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
          if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
            const parsedPacket = IlpPacket.deserializeIlpPrepare(data)

            // Ignore zero amount packets
            if (parsedPacket.amount === '0') {
              return next(data)
            }

            // Increase balance on prepare
            balance.add(parsedPacket.amount)
            log.debug('balance increased due to incoming ilp prepare. accountId=%s amount=%s newBalance=%s', accountId, parsedPacket.amount, balance.getValue())

            let result
            try {
              result = await next(data)
            } catch (err) {
              // Refund on error
              balance.subtract(parsedPacket.amount)
              log.debug('incoming packet refunded due to error. accountId=%s amount=%s newBalance=%s', accountId, parsedPacket.amount, balance.getValue())
              throw err
            }

            if (result[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
              // Refund on reject
              balance.subtract(parsedPacket.amount)
              log.debug('incoming packet refunded due to ilp reject. accountId=%s amount=%s newBalance=%s', accountId, parsedPacket.amount, balance.getValue())
            }

            return result
          } else {
            return next(data)
          }
        }
      })

      pipelines.incomingMoney.insertLast({
        name: 'balance',
        method: async (amount: string, next: MiddlewareCallback<string, void>) => {
          balance.subtract(amount)
          log.debug('balance reduced due to incoming settlement. accountId=%s amount=%s newBalance=%s', accountId, amount, balance.getValue())

          return next(amount)
        }
      })

      pipelines.outgoingData.insertLast({
        name: 'balance',
        method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
          if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
            const parsedPacket = IlpPacket.deserializeIlpPrepare(data)

            // Ignore zero amount packets
            if (parsedPacket.amount === '0') {
              return next(data)
            }

            let result
            try {
              result = await next(data)
            } catch (err) {
              // Do not apply any changes on an error
              log.debug('outgoing packet not applied due to error. accountId=%s amount=%s balance=%s', accountId, parsedPacket.amount, balance.getValue())
              throw err
            }

            if (result[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
              // Do not apply any changes on reject
              log.debug('outgoing packet not applied due to ilp reject. accountId=%s amount=%s balance=%s', accountId, parsedPacket.amount, balance.getValue())
            } else if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
              // Decrease balance on prepare
              balance.subtract(parsedPacket.amount)
              log.debug('balance decreased due to outgoing ilp packet being fulfilled. accountId=%s amount=%s newBalance=%s', accountId, parsedPacket.amount, balance.getValue())

              maybeSettle(bnSettleThreshold, bnSettleTo, balance)
            }

            return result
          } else {
            return next(data)
          }
        }
      })

      pipelines.outgoingMoney.insertLast({
        name: 'balance',
        method: async (amount: string, next: MiddlewareCallback<string, void>) => {
          balance.add(amount)
          log.debug('balance increased due to outgoing settlement. accountId=%s amount=%s newBalance=%s', accountId, amount, balance.getValue())

          return next(amount)
        }
      })
    } else {
      log.warn('(!!!) balance middleware NOT enabled for account, this account can spend UNLIMITED funds. accountId=%s', accountId)
    }
  }

  getStatus () {
    const accounts = {}
    this.balances.forEach((balance, accountId) => {
      accounts[accountId] = balance.toJSON()
    })
    return { accounts }
  }
}
