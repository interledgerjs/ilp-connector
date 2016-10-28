#!/usr/bin/env node

'use strict'

const path = require('path')
const exec = require('child_process').execSync

let cwd = path.resolve(__dirname, '..')

// Get current web branch
console.log('\n# Cloning web branch')
exec('rm -rf web', { cwd })
exec('git clone git@github.com:interledgerjs/ilp-connector.git --branch gh-pages --single-branch web', { cwd })

// Push changes
console.log('\n# Pushing web branch')
cwd = path.resolve(cwd, 'web')
exec('cd web')
exec('git add --all', { cwd })

const status = exec('git status --porcelain', { cwd }).toString('utf8')
if (!status.length) {
  console.log('no changes')
} else {
  console.log(status)
  exec('git commit -m \'chore: update gh-pages\'', { cwd })
  exec('git push', { cwd })
}
