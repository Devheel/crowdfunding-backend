const server = require('express').Router()
const gsheets = require('gsheets')
const {utcTimeParse, timeParse} = require('../lib/formats')
const slugify = require('../lib/slugify')

const dateParse = utcTimeParse('%x') //%x - the locale’s date
const dateTimeParse = timeParse('%x %H:%M')

const mapping = {
  '12oN7o21txZKxTH_RypfWLLeXFfZE2P-Yu5kg-VoHmfw': 'faqs',
  '1Y0vFkykAHuaGzkI5PEirnoGVmAREYr9RSUcFY7_okHk': 'updates',
  '1rktqc3xhluZLH6OrdmY456LaiCOk0L2tMD5ZjwG89lo': 'events'
}

const normalize = (data) => data.map( d => {
  return Object.assign({}, d, {
    published: d.hasOwnProperty('published') ? !!d.published : undefined,
    date: d.hasOwnProperty('date') ? dateParse(d.date) : undefined,
    dateTime: d.hasOwnProperty('dateTime') ? dateTimeParse(d.dateTime) : undefined,
    publishedDateTime: d.hasOwnProperty('publishedDateTime') ? dateTimeParse(d.publishedDateTime) : undefined,
    slug: d.hasOwnProperty('slug') ? slugify(d.slug) : undefined
  })
})

module.exports = (pgdb, logger) =>
  server.get('/gsheets/:key', async function(req, res, next) {
    const {key} = req.params
    const name = mapping[key]
    if(!key || !name) {
      logger.error('gsheets: no key', { req: req._log() })
      return res.status(400).end('invalid key')
    }
    logger.info('gsheets: starting...', { key, name })

    let sheet
    try {
      sheet = await gsheets.getWorksheet(key, 'live')
    } catch(e) {
      logger.error('gsheets: could not get sheet', { e, key, req: req._log() })
      return res.status(400).end('could not get sheet')
    }

    if(sheet) {
      const data = normalize(sheet.data)
      try {
        if(await pgdb.public.gsheets.count({name})) {
          await pgdb.public.gsheets.update({name}, {
            data,
            updatedAt: new Date()
          })
        } else {
          await pgdb.public.gsheets.insert({
            name,
            data,
            createdAt: new Date(),
            updatedAt: new Date()
          })
        }
      } catch(e) {
        logger.error('gsheets: error while trying to save data', { e, req: req._log() })
        return res.status(400).end('failed while trying to save data')
      }
    }
    logger.info('gsheets: finished successfully!', { key, name })

    res.status(200).end('success! new data published!')
  })
