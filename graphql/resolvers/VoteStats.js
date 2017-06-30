const {postalCodeData, postalCodeParsers} = require('../../lib/geo/postalCode')
const countryNameNormalizer = require('../../lib/geo/country').nameNormalizer
const nest = require('d3-collection').nest
const {descending} = require('d3-array')
// see commented code below for chSlt2012
// const getBFSNr = require('../../lib/geo/chPostalCode').getBFSNr
// const getSlt = require('../../lib/geo/chSlt').getSlt
// const util = require('util')

const reduceOptions = (entries) =>
  nest()
    .key(o => o.name)
    .rollup(values => ({
      name: values[0].name,
      id: values[0].id,
      count: values.reduce(
        (sum, v) => sum + v.count,
        0
      )
    }))
    .entries(entries)
    .map(o => ({
      name: o.value.name,
      id: o.value.id,
      count: o.value.count
    }))

const countStatsCounts = (statsCounts, sort = true) => {
  const keyOrder = (key) => {
    switch (key) {
      case 'others':
        return -1
      case 'null':
        return -2
      default:
        return 0
    }
  }
  const countedStatsCounts = statsCounts
    .map(c => {
      const optionCountMax = c.options.map(o => o.count).reduce(
        (prev, current) => prev > current ? prev : current,
        0
      )
      return Object.assign({}, c, {
        count: c.options.reduce(
          (sum, v) => sum + v.count,
          0
        ),
        options: c.options
          .map(o => Object.assign({}, o, {
            winner: o.count === optionCountMax
          }))
          .sort((a, b) => descending(a.count, b.count))
      })
    })
  if (sort) {
    return countedStatsCounts
      .sort((a, b) => (
        descending(keyOrder(a.key), keyOrder(b.key)) ||
        descending(a.count, b.count)
      ))
  } else {
    return countedStatsCounts
  }
}

module.exports = {
  ages: async (stats, args, {pgdb}) => {
    if (stats && stats.ages) { // cached by countVoting
      return stats.ages
    }

    // no access to voting here, we have one voting and no time: don't constrain to votingId

    // others (no birthday)
    const nullOptions = await pgdb.query(`
      SELECT
        vo.id AS id,
        vo.name AS name,
        COUNT(b."votingOptionId") AS count
      FROM
        "votingOptions" vo
      LEFT JOIN
        ballots b
        ON vo.id=b."votingOptionId"
      LEFT JOIN
        users u
        ON b."userId"=u.id
      WHERE
        u.birthday is null
      GROUP BY
        1, 2
      ORDER BY
        3 DESC
    `)

    const nullStatsCount = {
      key: 'null',
      options: nullOptions
    }

    const flatAgeOptions = await pgdb.query(`
      SELECT
        min,
        max,
        id,
        name,
        count
      FROM (
        SELECT
          *
        FROM
          json_to_recordset('[
            {"min": 0, "max": 19},
            {"min": 20, "max": 29},
            {"min": 30, "max": 39},
            {"min": 40, "max": 49},
            {"min": 50, "max": 59},
            {"min": 60, "max": 69},
            {"min": 70, "max": 79},
            {"min": 80, "max": null}
          ]') as x("min" int, "max" int)
      ) e1 JOIN LATERAL (
        SELECT
          vo.id AS id,
          vo.name AS name,
          COUNT(b."votingOptionId") AS count
        FROM
          "votingOptions" vo
        JOIN
          ballots b
          ON vo.id=b."votingOptionId"
        JOIN
          users u
          ON
            b."userId"=u.id AND
            u.birthday is not null AND
            extract(year from age(u.birthday)) >= e1.min AND
            ((e1.max IS NULL) OR extract(year from age(u.birthday)) <= e1.max)
        GROUP BY
          1, 2
        ORDER BY
          3 DESC
      ) e2 ON true;
    `)

    const allOptions = await pgdb.query(`
      SELECT
        vo.id AS id,
        vo.name AS name,
        0 AS count
      FROM
        "votingOptions" vo
    `)
    const ageStatsCount = nest()
      .key(d => d.max ? `${d.min}-${d.max}` : `${d.min}+`)
      .entries(flatAgeOptions)
      .map(d => ({
        key: d.key,
        options: d.values.map(o => ({
          id: o.id,
          name: o.name,
          count: o.count
        }))
      }))
      .map(d => {
        if (d.options.length < 3) {
          let missingOptions = []
          allOptions.forEach(option => {
            if (!d.options.find(o => o.id === option.id)) {
              missingOptions.push(option)
            }
          })
          return Object.assign({}, d, {
            options: d.options.concat(missingOptions)
          })
        }
        return d
      })

    return countStatsCounts(ageStatsCount.concat([nullStatsCount]), false)
  },

  countries: async (stats, args, {pgdb}) => {
    if (stats && stats.countries) { // cached by countVoting
      return stats.countries
    }

    // no access to voting here, we have one voting and no time: don't constrain to votingId

    const allCountriesVotingOptions = await pgdb.query(`
      SELECT
        "countryName",
        id,
        name,
        count
      FROM (
        SELECT
          lower(trim(a.country)) AS "countryName",
          array_agg(b.id) AS ballot_ids
        FROM
          users u
        JOIN
          ballots b
          ON b."userId"=u.id
        LEFT JOIN
          addresses a
          ON u."addressId" = a.id
        GROUP BY
          1
        ORDER BY
          1
      ) e1 JOIN LATERAL (
        SELECT
          vo.id AS id,
          vo.name AS name,
          COUNT(b."votingOptionId") AS count
        FROM
          "votingOptions" vo
        LEFT JOIN
          ballots b
          ON
            vo.id=b."votingOptionId" AND
            ARRAY[b.id] && e1.ballot_ids
        GROUP BY
          1, 2
        ORDER BY
          3 DESC
      ) e2 ON true;
    `)

    const nullCountryOptions = {
      key: 'null',
      options: allCountriesVotingOptions.filter(o => o.countryName === null)
    }

    const countryOptions = nest()
      .key(d => countryNameNormalizer(d.countryName))
      .entries(allCountriesVotingOptions.filter(d => d.countryName !== null))
      .map(d => ({
        key: d.key,
        options: reduceOptions(d.values)
      }))

    let designatedCountryOptions = []
    let otherCountryOptions = []
    countryOptions.forEach(c => {
      const total = c.options.reduce(
        (sum, v) => sum + v.count,
        0
      )
      if (total >= 7) {
        designatedCountryOptions.push(c)
      } else {
        otherCountryOptions.push(c)
      }
    })

    const combinedOtherCountryOptions = {
      key: 'others',
      options: reduceOptions([].concat.apply([], otherCountryOptions.map(d => d.options)))
    }

    return countStatsCounts([].concat(designatedCountryOptions, combinedOtherCountryOptions, nullCountryOptions))
  },

  chCantons: async (stats, args, {pgdb}) => {
    if (stats && stats.chCantons) { // cached by countVoting
      return stats.chCantons
    }

    // no access to voting here, we have one voting and no time: don't constrain to votingId

    const allCountriesWithPostalCodesVotingOptions = await pgdb.query(`
      SELECT
        "countryName",
          "postalCode",
          id,
          name,
          count
      FROM (
          SELECT
            lower(trim(a.country)) AS "countryName",
            trim(a."postalCode") as "postalCode",
            array_agg(b.id) AS ballot_ids
          FROM
            users u
          JOIN
            ballots b
            ON b."userId"=u.id
          LEFT JOIN
            addresses a
            ON u."addressId" = a.id
          GROUP BY
            1, 2
          ORDER BY
            2
      ) e1 JOIN LATERAL (
          SELECT
            vo.id AS id,
            vo.name AS name,
            COUNT(b."votingOptionId") AS count
          FROM
            "votingOptions" vo
          LEFT JOIN
            ballots b
            ON
              vo.id=b."votingOptionId" AND
              ARRAY[b.id] && e1.ballot_ids
          GROUP BY
            1, 2
          ORDER BY
            3 DESC
      ) e2 ON true;
    `)

    const pcParser = postalCodeParsers['CH']

    const switzerlandOptions = nest()
      .key(d => countryNameNormalizer(d.countryName))
      .entries(allCountriesWithPostalCodesVotingOptions.filter(d => d.countryName !== null))
      .find(d => d.key === 'Schweiz')

    const postalCodeOptions = nest()
      .key(d => pcParser(d.postalCode))
      .entries(switzerlandOptions.values)
      .map(d => {
        const baseData = postalCodeData('CH', d.key)
        return {
          key: baseData && baseData.stateAbbr.length > 0
            ? baseData.stateAbbr
            : 'others',
          options: reduceOptions(d.values)
        }
      })

    const stateStatsCount = nest()
      .key(c => c.key)
      .entries(postalCodeOptions)
      .map(c => ({
        key: c.key,
        options: reduceOptions([].concat.apply([], c.values.map(d => d.options)))
      }))

    return countStatsCounts(stateStatsCount)
  }

  /* addresses -> bfsNr matching needs refinement. check lib/geo/chPostalCode.js
  chSlt2012: async (_, args, {pgdb}) => {
    //no access to voting here, we have one voting and no time: don't constrain to votingId

    const allCountriesWithPostalCodesAndCityVotingOptions = await pgdb.query(`
      SELECT
        "countryName",
          "postalCode",
          city,
          id,
          name,
          count
      FROM (
          SELECT
            lower(trim(a.country)) AS "countryName",
            trim(a."postalCode") as "postalCode",
            trim(a.city) as city,
            array_agg(b.id) AS ballot_ids
          FROM
            users u
          JOIN
            ballots b
            ON b."userId"=u.id
          LEFT JOIN
            addresses a
            ON u."addressId" = a.id
          GROUP BY
            1, 2, 3
          ORDER BY
            2, 3
      ) e1 JOIN LATERAL (
          SELECT
            vo.id AS id,
            vo.name AS name,
            COUNT(b."votingOptionId") AS count
          FROM
            "votingOptions" vo
          LEFT JOIN
            ballots b
            ON
              vo.id=b."votingOptionId" AND
              ARRAY[b.id] && e1.ballot_ids
          GROUP BY
            1, 2
          ORDER BY
            3 DESC
      ) e2 ON true;
    `)

    const pcParser = postalCodeParsers['CH']

    const switzerlandOptions = nest()
      .key( d => countryNameNormalizer(d.countryName))
      .entries(allCountriesWithPostalCodesAndCityVotingOptions.filter( d => d.countryName !== null))
      .find( d => d.key === 'Schweiz')

    const bfsOptions = nest()
      .key( d => getBFSNr(d.postalCode, d.city.trim()))
      .entries(switzerlandOptions.values)

    //console.log(util.inspect(bfsOptions, {depth: null}))

    const reducedBfsOptions = bfsOptions
      .map( d => ({
        bfsNr: d.key,
        options: reduceOptions(d.values)
      }))

    const chSlt2012 = nest()
      .key( d => getSlt(d.bfsNr))
      .entries(reducedBfsOptions)
      .map( d => ({
        key: d.key === 'undefined' ? 'others' : d.key,
        options: reduceOptions( [].concat.apply([], d.values.map( c => c.options) ) )
      }))

    return countStatsCounts(chSlt2012)
  },
  */
}
