const geoipDatabase = require('geoip-database')
const maxmind = require('maxmind')
const cityLookup = maxmind.openSync(geoipDatabase.city)

module.exports = (ip) => {
  const geo = cityLookup.get(ip)
  let country
  // eslint-disable-next-line no-empty
  try { country = geo.country.names.de } catch (e) { }
  let city
  // eslint-disable-next-line no-empty
  try { city = geo.city.names.de } catch (e) { }
  return {country, city}
}
