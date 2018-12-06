import * as Prometheus from 'prom-client'
import { AccountInfo } from '../types/accounts'

function mergeAccountLabels (account: { accountId: string, accountInfo: AccountInfo }, labels: Prometheus.labelValues): Prometheus.labelValues {
  labels['account'] = account.accountId
  labels['asset'] = account.accountInfo.assetCode
  labels['scale'] = account.accountInfo.assetScale
  return labels
}

export class AccountCounter extends Prometheus.Counter {
  constructor (configuration: Prometheus.CounterConfiguration) {
    configuration.labelNames = (configuration.labelNames || [])
    configuration.labelNames.push('account', 'asset', 'scale')
    super(configuration)
  }
  increment (account: { accountId: string, accountInfo: AccountInfo }, labels: Prometheus.labelValues, value?: number) {
    return this.inc(mergeAccountLabels(account, labels), value)
  }
}

export class AccountGauge extends Prometheus.Gauge {
  constructor (configuration: Prometheus.GaugeConfiguration) {
    configuration.labelNames = (configuration.labelNames || [])
    configuration.labelNames.push('account', 'asset', 'scale')
    super(configuration)
  }
  setValue (account: { accountId: string, accountInfo: AccountInfo }, labels: Prometheus.labelValues, value: number) {
    return this.set(mergeAccountLabels(account, labels), value)
  }
}

export default class Stats {
  public incomingDataPackets: AccountCounter
  public incomingDataPacketValue: AccountCounter
  public outgoingDataPackets: AccountCounter
  public outgoingDataPacketValue: AccountCounter
  public incomingMoney: AccountGauge
  public outgoingMoney: AccountGauge
  public rateLimitedPackets: AccountCounter
  public rateLimitedMoney: AccountCounter
  public balance: AccountGauge
  private registry: Prometheus.Registry

  constructor () {
    this.registry = new (Prometheus.Registry)()

    this.incomingDataPackets = new AccountCounter({
      name: 'ilp_connector_incoming_ilp_packets',
      help: 'Total number of incoming ILP packets',
      labelNames: [ 'result', 'code'],
      registers: [this.registry]
    })

    this.incomingDataPacketValue = new AccountCounter({
      name: 'ilp_connector_incoming_ilp_packet_value',
      help: 'Total value of incoming ILP packets',
      labelNames: [ 'result', 'code'],
      registers: [this.registry]
    })

    this.outgoingDataPackets = new AccountCounter({
      name: 'ilp_connector_outgoing_ilp_packets',
      help: 'Total number of outgoing ILP packets',
      labelNames: [ 'result', 'code' ],
      registers: [this.registry]
    })

    this.outgoingDataPacketValue = new AccountCounter({
      name: 'ilp_connector_outgoing_ilp_packet_value',
      help: 'Total value of outgoing ILP packets',
      labelNames: [ 'result', 'code' ],
      registers: [this.registry]
    })

    this.incomingMoney = new AccountGauge({
      name: 'ilp_connector_incoming_money',
      help: 'Total of incoming money',
      labelNames: [ 'result' ],
      registers: [this.registry]
    })

    this.outgoingMoney = new AccountGauge({
      name: 'ilp_connector_outgoing_money',
      help: 'Total of outgoing money',
      labelNames: [ 'result' ],
      registers: [this.registry]
    })

    this.rateLimitedPackets = new AccountCounter({
      name: 'ilp_connector_rate_limited_ilp_packets',
      help: 'Total of rate limited ILP packets',
      registers: [this.registry]
    })

    this.rateLimitedMoney = new AccountCounter({
      name: 'ilp_connector_rate_limited_money',
      help: 'Total of rate limited money requests',
      registers: [this.registry]
    })

    this.balance = new AccountGauge({
      name: 'ilp_connector_balance',
      help: 'Balances on peer account',
      registers: [this.registry]
    })
  }

  getStatus () {
    return this.registry.getMetricsAsJSON()
  }
}
