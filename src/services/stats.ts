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
  public incomingDataPackets = new AccountCounter({
    name: 'ilp_connector_incoming_ilp_packets',
    help: 'Total number of incoming ILP packets',
    labelNames: [ 'result', 'code'] })

  public incomingDataPacketValue = new AccountCounter({
    name: 'ilp_connector_incoming_ilp_packet_value',
    help: 'Total value of incoming ILP packets',
    labelNames: [ 'result', 'code'] })

  public outgoingDataPackets = new AccountCounter({
    name: 'ilp_connector_outgoing_ilp_packets',
    help: 'Total number of outgoing ILP packets',
    labelNames: [ 'result', 'code' ] })

  public outgoingDataPacketValue = new AccountCounter({
    name: 'ilp_connector_outgoing_ilp_packet_value',
    help: 'Total value of outgoing ILP packets',
    labelNames: [ 'result', 'code' ] })

  public incomingMoney = new AccountGauge({
    name: 'ilp_connector_incoming_money',
    help: 'Total of incoming money',
    labelNames: [ 'result' ] })

  public outgoingMoney = new AccountGauge({
    name: 'ilp_connector_outgoing_money',
    help: 'Total of outgoing money',
    labelNames: [ 'result' ] })

  public rateLimitedPackets = new AccountCounter({
    name: 'ilp_connector_rate_limited_ilp_packets',
    help: 'Total of rate limited ILP packets' })

  public rateLimitedMoney = new AccountCounter({
    name: 'ilp_connector_rate_limited_money',
    help: 'Total of rate limited money requests' })

  public balance = new AccountGauge({
    name: 'ilp_connector_balance',
    help: 'Balances on peer account' })

  getStatus () {
    return Prometheus.register.getMetricsAsJSON()
  }
}
