//
// This script counts the ballots of a vote and upserts vote.result
// required params
//   1) vote name
//   2) optional: message
//   3) optional: winner's votingOption.name (in case of final vote)
//
// usage
// cf_server  node script/countVoting.js NAME [MESSAGE] [WINNER]
//


const PgDb = require('../lib/pgdb')
require('dotenv').config()

PgDb.connect().then( async (pgdb) => {
  console.log('counting vote...')

  const NAME = process.argv[2]
  if(!NAME) {
    throw new Error('NAME must be provided')
  }
  const MESSAGE = process.argv[3]
  const WINNER = process.argv[4]

  const voting = await pgdb.public.votings.findOne({ name: NAME })
  if(!voting) {
    throw new Error(`a voting with the name '${NAME}' could not be found!`)
  }

  const counts = await pgdb.query(`
    SELECT
      vo.id AS id,
      vo.name AS name,
      COUNT(b."votingOptionId") AS count
    FROM
      "votingOptions" vo
    LEFT JOIN
      ballots b
      ON vo.id=b."votingOptionId"
    WHERE
      vo."votingId" = :votingId
    GROUP BY
      1, 2
    ORDER BY
      3 DESC
  `, {
    votingId: voting.id
  })

  let winner
  if(counts[0].count === counts[1].count) { //undecided
    if(!WINNER) {
      throw new Error(`voting is undecided you must provide the winners votingOption name as the third parameter!`)
    }
    winner = counts.find( c => c.name === WINNER )
    if(!winner) {
      throw new Error(`voting is undecided but a votingOption with the name '${WINNER}' could not be found!`)
    }
  } else {
    winner = counts[0]
  }

  const newVoting = await pgdb.public.votings.updateAndGetOne({
    id: voting.id
  }, {
    result: {
      options: counts.map( c => Object.assign({}, c, {
        winner: (c.id === winner.id)
      })),
      updatedAt: new Date(),
      createdAt: voting.result.createdAt || new Date(),
      message: MESSAGE //ignored by postgres is null
    }
  })
  console.log("finished! The result is:")
  console.log(newVoting.result)
  console.log("🎉🎉🎉🎉🎉🎉")

}).then( () => {
  process.exit()
}).catch( e => {
  console.error(e)
  process.exit(1)
})
