const fetch = require('isomorphic-unfetch')
//usage
//sendMail({
//  to: 'p@tte.io',
//  fromEmail: 'jefferson@project-r.construction',
//  fromName: 'Jefferson',
//  subject: 'dear friend',
//  text: 'asdf asdf'
//})
module.exports = (mail) => {
  const {DEFAULT_MAIL_FROM_ADDRESS, DEFAULT_MAIL_FROM_NAME, NODE_ENV, SEND_MAILS} = process.env

  //sanitize
  mail.to = [{email: mail.to}]
  mail.from_email = mail.fromEmail || DEFAULT_MAIL_FROM_ADDRESS
  mail.from_name = mail.fromName || DEFAULT_MAIL_FROM_NAME
  delete mail.fromName
  delete mail.fromEmail

  //don't send in dev, expect SEND_MAILS is true
  //don't send mails if SEND_MAILS is false
  const DEV = NODE_ENV && NODE_ENV !== 'production'
  if( SEND_MAILS === 'false' || (DEV && SEND_MAILS !== 'true') ) {
    console.log('\n\nmail (only sent in production):\n', mail)
    return true
  }

  return fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      key: process.env.MANDRILL_API_KEY,
      message: mail
    })
  })
}

