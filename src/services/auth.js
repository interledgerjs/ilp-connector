'use strict'

const passport = require('koa-passport')
const ClientCertStrategy = require('passport-client-certificate').Strategy
const UnauthorizedError = require('five-bells-shared/errors/unauthorized-error')
const config = require('./config')

passport.use(new ClientCertStrategy((certificate, done) => {
  if (!config.getIn(['auth', 'client_certificates_enabled'])) {
    return done(new UnauthorizedError('Unsupported authentication method'))
  }
}))

