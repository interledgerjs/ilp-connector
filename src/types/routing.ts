export interface Route {
  nextHop: string,
  path: string[]
}

export interface BroadcastRoute extends Route {
  prefix: string,
  epoch: number
}

export interface IncomingRoute {
  peer: string,
  prefix: string,
  path: string[]
}

export interface RouteUpdateParams {
  speaker: string,
  routingTableId: string,
  holdDownTime: number,
  fromEpoch: number,
  toEpoch: number,
  newRoutes: IncomingRoute[],
  withdrawnRoutes: string[]
}
