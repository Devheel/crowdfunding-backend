const fetch = require('isomorphic-unfetch')
require('dotenv').config()

module.exports = async (url, width, height) => {
  const {PHANTOMJSCLOUD_API_KEY, BASIC_AUTH_USER, BASIC_AUTH_PASS, PHANTOM_COOKIE} = process.env

  let body = {
    url,
    content: null,
    urlSettings: {
      operation: 'GET',
      encoding: 'utf8',
      headers: {},
      data: null
    },
    renderType: 'png',
    outputAsJson: false,
    requestSettings: {
      ignoreImages: false,
      disableJavascript: false,
      userAgent: 'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/534.34 (KHTML, like Gecko) Safari/534.34 PhantomJS/2.0.0 (PhantomJsCloud.com/2.0.1)',
      customHeaders: {
        'DNT': 1
      }
    },
    renderSettings: {}
  }
  if (width && height) {
    body.renderSettings.viewport = { width, height }
  }
  if (PHANTOM_COOKIE) {
    body.requestSettings.customHeaders = {
      'cookie': PHANTOM_COOKIE
    }
  }
  if (BASIC_AUTH_USER) {
    body.requestSettings.authentication = {
      userName: BASIC_AUTH_USER,
      password: BASIC_AUTH_PASS
    }
  }

  return (await fetch(`https://PhantomJsCloud.com/api/browser/v2/${PHANTOMJSCLOUD_API_KEY}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })).buffer()
}
