'use strict'

const randomgraph = require('randomgraph')
const Connector = require('../..')

const graph = randomgraph.BarabasiAlbert(110, 10, 2)

const configs = []
graph.nodes.forEach(({ label }, i) => {
  configs.push({
    store: 'memdown',
    backend: 'one-to-one',
    accounts: {
      mini: {
        relation: 'child',
        plugin: 'ilp-plugin-btp',
        assetCode: 'USD',
        assetScale: 9,
        options: {
          listener: {
            port: 20000 + i,
            secret: 'mini'
          }
        }
      }
    },
    ilpAddress: 'test.u' + i + 'x',
    adminApi: true,
    adminApiPort: 7700 + i
  })
})
graph.edges.forEach((edge, i) => {
  configs[edge.source].accounts['u' + edge.target] = {
    relation: 'peer',
    plugin: 'ilp-plugin-btp',
    assetCode: 'USD',
    assetScale: 9,
    options: {
      listener: {
        port: 10000 + i,
        secret: 'edge' + i
      }
    }
  }
  configs[edge.target].accounts['u' + edge.source] = {
    relation: 'peer',
    plugin: 'ilp-plugin-btp',
    assetCode: 'USD',
    assetScale: 9,
    options: {
      server: `btp+ws://:edge${i}@localhost:${10000 + i}`
    }
  }
})

configs.forEach(config => {
  const connector = Connector.createApp(config)
  connector.listen()
})

console.log('configs', configs)
// const { resolve } = require('path')
//
// const basicConnector = {
//   script: resolve(__dirname, '../../src/index.js'),
//   env: {
//     DEBUG: 'connector*,ilp*',
//     CONNECTOR_STORE: 'memdown',
//     CONNECTOR_BACKEND: 'one-to-one'
//   }
// }
//
// const basicPlugin = {
//   plugin: 'ilp-plugin-btp',
//   assetCode: 'USD',
//   assetScale: 9
// }
//
// const services = []
//
// services.push({
//   ...basicConnector,
//   name: 'u1',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS: 'test.u1',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7701,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u2: {
//         ...basicPlugin,
//         relation: 'peer',
//         options: {
//           listener: {
//             port: 10101,
//             secret: 'u1u2'
//           }
//         }
//       },
//       u5: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10105,
//             secret: 'u1u5'
//           }
//         }
//       }
//     })
//   }
// })
//
// services.push({
//   ...basicConnector,
//   name: 'u2',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS: 'test.u2',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7702,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u1: {
//         ...basicPlugin,
//         relation: 'peer',
//         options: {
//           server: 'btp+ws://:u1u2@localhost:10101'
//         }
//       },
//       u3: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10203,
//             secret: 'u2u3'
//           }
//         }
//       },
//       u4: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10204,
//             secret: 'u2u4'
//           }
//         }
//       }
//     })
//   }
// })
//
// services.push({
//   ...basicConnector,
//   name: 'u3',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS: 'test.u3',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7703,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u2: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u2u3@localhost:10203'
//         }
//       },
//       u5: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10305,
//             secret: 'u3u5'
//           }
//         }
//       },
//       u6: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10306,
//             secret: 'u3u6'
//           }
//         }
//       }
//     })
//   }
// })
//
// services.push({
//   ...basicConnector,
//   name: 'u4',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS: 'test.u4',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7704,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u2: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u2u4@localhost:10204'
//         }
//       },
//       u6: {
//         ...basicPlugin,
//         relation: 'child',
//         sendRoutes: true,
//         receiveRoutes: true,
//         options: {
//           listener: {
//             port: 10406,
//             secret: 'u4u6'
//           }
//         }
//       }
//     })
//   }
// })
//
// services.push({
//   ...basicConnector,
//   name: 'u5',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS: 'test.u5',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7705,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u1: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u1u5@localhost:10105'
//         }
//       },
//       u3: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u3u5@localhost:10305'
//         }
//       }
//     })
//   }
// })
//
// services.push({
//   ...basicConnector,
//   name: 'u6',
//   env: {
//     ...basicConnector.env,
//     CONNECTOR_ILP_ADDRESS_INHERIT_FROM: 'u4',
//     CONNECTOR_ADMIN_API: true,
//     CONNECTOR_ADMIN_API_PORT: 7706,
//     CONNECTOR_ACCOUNTS: JSON.stringify({
//       u3: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u3u6@localhost:10306'
//         }
//       },
//       u4: {
//         ...basicPlugin,
//         relation: 'parent',
//         options: {
//           server: 'btp+ws://:u4u6@localhost:10406'
//         }
//       }
//     })
//   }
// })
//
// module.exports = services
