export interface AccountInfo {
  relation: 'parent' | 'peer' | 'child',
  plugin: string,
  assetCode: string,
  assetScale: number,
  options: object,
  sendRoutes: boolean,
  receiveRoutes: boolean,
  ilpAddressSegment: string
}
