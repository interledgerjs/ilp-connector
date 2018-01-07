'use strict'

const { readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')
const unified = require('unified')
const parse = require('remark-parse')
const toc = require('remark-toc')
const stringify = require('remark-stringify')
const inject = require('mdast-util-inject')
const { constantCase } = require('change-case')
const { render: renderJsonSchema } = require('@justmoon/json-schema-to-markdown')

function injectConfigDocs () {
  return function transform (node) {
    const schemaMd = processSchema(require(resolve(__dirname, '../src/schemas/Config.json')))
    const toInject = unified().use(parse).parse(schemaMd)
    inject('Configuration Variables', node, toInject)
  }
}

const CONFIG_HEADER = `
<!-- WARNING: This section is auto-generated. Please do not edit in README.md -->
`

const renderComplexDescription = optionDefinition => {
  if (
    (optionDefinition.type === 'object' && (
      typeof optionDefinition.properties === 'object' ||
      typeof optionDefinition.additionalProperties === 'object'
    )) ||
    optionDefinition.type === 'array'
  ) {
    return renderJsonSchema(optionDefinition)
  } else {
    return optionDefinition.description
  }
}

const renderExample = optionDefinition => optionDefinition.example ? `
Example:

\`\`\`json
${JSON.stringify(optionDefinition.example)}
\`\`\`
` : ''

function processSchema (schema) {
  return CONFIG_HEADER + Object.entries(schema.properties).map(([option, optionDefinition]) => `
### \`${option}\`

* Environment: \`CONNECTOR_${constantCase(option)}\`
* Type: \`${optionDefinition.type}\`
* Default: \`${JSON.stringify(optionDefinition.default)}\`

${renderComplexDescription(optionDefinition)}

${renderExample(optionDefinition)}
`).join('')
}

const readmePath = resolve(__dirname, '../README.md')

unified()
  .use(parse)
  .use(injectConfigDocs)
  .use(toc, { maxDepth: 3 })
  .use(stringify, {
    bullet: '*',
    listItemIndent: '1'
  })
  .process(readFileSync(readmePath, 'utf8'), function (err, file) {
    if (err) throw err
    writeFileSync(readmePath, String(file), 'utf8')
  })
