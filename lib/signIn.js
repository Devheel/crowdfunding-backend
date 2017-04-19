const uuid = require('uuid/v4')
const rndWord = require('random-noun-generator-german')
const kraut = require('kraut')
const geoForIP = require('./geoForIP')
const sendMailTemplate = require('./sendMailTemplate')
const logger = require('./logger')
const fetch = require('isomorphic-unfetch')

module.exports = async (email, req, t) => {
  if(req.user) {
    //fail gracefully
    return {phrase: ''}
  }

  if(!email.match(/^.+@.+\..+$/)) {
    logger.info('invalid email', { req: req._log(), email })
    throw new Error(t('api/email/invalid'))
  }

  const token = uuid()
  const ua = req.headers['user-agent']
  const phrase = kraut.adjectives.random()+' '+kraut.verbs.random()+' '+rndWord()
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
  const geo = geoForIP(ip)

  req.session.email = email
  req.session.token = token
  req.session.ip = ip
  req.session.ua = ua
  if(geo) {
    req.session.geo = geo
  }

  const verificationUrl = (process.env.PUBLIC_URL || 'http://'+req.headers.host)+'/auth/email/signin/'+token

  // AUTO_LOGIN for automated testing
  if(process.env.AUTO_LOGIN) {
    // email addresses @test.project-r.construction will be auto logged in
    // - email addresses containing «not» will neither be logged in nor send an sign request
    const testMatch = email.match(/^([a-zA-Z0-9._%+-]+)@test\.project-r\.construction$/)
    if (testMatch) {
      if(testMatch[1].indexOf('not') === -1) {
        setTimeout( () => {
          const {BASIC_AUTH_USER, BASIC_AUTH_PASS} = process.env
          if(BASIC_AUTH_PASS) {
            fetch(verificationUrl, {
              headers: {
                'Authorization': 'Basic '+(new Buffer(BASIC_AUTH_USER+':'+BASIC_AUTH_PASS).toString('base64'))
              }
            })
          } else {
            fetch(verificationUrl)
          }
        }, 2000)
      }

      return {phrase}
    }
  }

  await sendMailTemplate({
    to: email,
    fromEmail: process.env.AUTH_MAIL_FROM_ADDRESS,
    subject: t('api/signin/mail/subject'),
    templateName: 'cf_signin',
    globalMergeVars: [
      { name: 'LOCATION',
        content: geo
      },
      { name: 'SECRET_WORDS',
        content: phrase
      },
      { name: 'LOGIN_LINK',
        content: verificationUrl
      }
    ]
  })

  return {phrase}
}