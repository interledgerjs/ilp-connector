const providerConfig = {
  'loop-back': {
    type: 'loop-back',
    options: {
      defaultAccountInfo: {
        plugin: 'ilp-plugin-btp',
        relation: 'child',
        assetCode: 'USD',
        assetScale: 10
      },
      loopBackAccounts: ['load-test']
    }
  },
  'plugin': {
    type: 'plugin'
  }
}

function printConfig (config) {
  console.log(config)
}

printConfig(JSON.stringify(providerConfig))