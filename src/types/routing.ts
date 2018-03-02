export interface Route {
  nextHop: string,
  path: string[],
  auth: Buffer
}

export interface BroadcastRoute extends Route {
  prefix: string
}

export interface IncomingRoute {
  peer: string,
  prefix: string,
  path: string[],
  auth: Buffer
}
