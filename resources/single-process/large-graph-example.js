'use strict'

const randomgraph = require('randomgraph')
const Connector = require('../..')

const graph = randomgraph.BarabasiAlbert(200, 10, 2)

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
    ilpAddress: 'test.u' + i,
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

console.log(`Launching ${configs.length} connectors...`)

configs.forEach(config => {
  const connector = Connector.createApp(config)
  connector.listen()
})
