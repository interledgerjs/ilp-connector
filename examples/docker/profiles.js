
const connectorConfig = {
  ilpAddress: 'test.quickstart',
  accounts: {
    alice: {
      relation: 'child',
      sendRoutes: false,
      receiveRoutes: false,
      assetScale: 6,
      assetCode: 'XRP',
      plugin: 'ilp-plugin-btp',
      options: {
        listener: {
          port: 9000
        }
      }
    }
  }
}

const pluginConfig = {
  accounts: {
    parent: {
      relation: 'parent',
      sendRoutes: false,
      receiveRoutes: false,
      assetScale: 6,
      assetCode: 'XRP',
      plugin: 'ilp-plugin-btp',
      options: {
        server: 'btp+ws://:u2u3@localhost:10203'
      }
    }
  }
}

const printAccount = (config) => {
  console.log(JSON.stringify(config.accounts))
}

printAccount(connectorConfig)
printAccount(pluginConfig)
