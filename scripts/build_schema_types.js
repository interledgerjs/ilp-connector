'use strict'

const fs = require('fs')
const { resolve } = require('path')
const { compileFromFile } = require('json-schema-to-typescript')

const schemas = ['Config.json', 'BalanceUpdate.json']

// compile from file
;(async function () {
  for (let schema of schemas) {
    // Have to pass an empty options object, otherwise we trigger a bug where
    // the cwd for the JSON schema $ref resolver defaults to the current
    // working directory instead of the file's directory.
    let ts = await compileFromFile(resolve(__dirname, '../src/schemas/', schema), {})

    if (schema === 'Config.json') {
      ts = ts
        // This is the only way to let Config inherit from the interface without
        // redefining all the fields.
        .replace('export interface Config', 'export class Config')
        // Ignore the error stating that `accounts` isn't assigned in the
        // constructor.
        .replace('accounts: {', 'accounts!: {')
    }

    fs.writeFileSync(resolve(__dirname, '../src/schemas/', schema.split('.')[0] + '.ts'), ts)
  }
})()
  .catch(err => console.error(err))
