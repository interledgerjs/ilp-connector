'use strict'

import PrefixMap from '../routing/prefix-map'
import { Route } from '../types/routing'

export default class RoutingTable extends PrefixMap<Route> {}
