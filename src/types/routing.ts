import LiquidityCurve from '../routing/liquidity-curve'

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
  path: string[],
  curve?: LiquidityCurve,
  minMessageWindow: number
}

export interface RouteUpdateParams {
  newRoutes: IncomingRoute[],
  unreachableThroughMe: string[],
  requestFullTable: boolean,
  holdDownTime: number
}
