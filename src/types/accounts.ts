export interface AccountInfo {
  relation: 'parent' | 'peer' | 'child',
  plugin: string,
  assetCode: string,
  assetScale: number,
  balance?: {
    minimum: string,
    maximum: string,
    settleThreshold?: string,
    settleTo: string
  },
  deduplicate?: {
    cleanupInterval: number,
    packetLifetime: number
  },
  maxPacketAmount?: string,
  throughput?: {
    refillPeriod?: number,
    incomingAmount?: string,
    outgoingAmount?: string
  },
  rateLimit?: {
    refillPeriod?: number,
    refillCount?: number,
    capacity?: number
  },
  options?: object,
  sendRoutes?: boolean,
  receiveRoutes?: boolean,
  ilpAddressSegment?: string
}
