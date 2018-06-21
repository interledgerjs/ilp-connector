import { create as createLogger } from '../common/log'
const log = createLogger('alert-middleware')
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
import * as IlpPacket from 'ilp-packet'

const { T04_INSUFFICIENT_LIQUIDITY } = IlpPacket.Errors.codes

export interface Alert {
  id: number
  accountId: string
  createdAt: Date
  message: string
}

export default class AlertMiddleware implements Middleware {
  private alerts: {[id: string]: Alert} = {}
  private nextAlertId: number = Date.now()

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.outgoingData.insertLast({
      name: 'alert',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        const result = await next(data)
        if (result[0] !== IlpPacket.Type.TYPE_ILP_REJECT) return result

        const rejectPacket = IlpPacket.deserializeIlpReject(result)
        if (rejectPacket.code !== T04_INSUFFICIENT_LIQUIDITY) return result

        // The peer rejected a packet which, according to the local balance, should
        // have succeeded. This can happen when our local connector owes the peer
        // money but restarted before it was settled.
        if (rejectPacket.message !== 'exceeded maximum balance.') return result

        log.warn('generating alert for account=%s message="%s"', accountId, rejectPacket.message)

        const id = this.nextAlertId++
        this.alerts[id] = {
          id,
          accountId,
          message: rejectPacket.message,
          createdAt: new Date()
        }

        return result
      }
    })
  }

  getAlerts (): Alert[] {
    return Object.keys(this.alerts)
      .map((id) => this.alerts[id])
      .sort((a, b) => a.id - b.id)
  }

  dismissAlert (id: number) {
    delete this.alerts[id]
  }
}
