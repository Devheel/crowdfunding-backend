const {dsvFormat} = require('d3-dsv')
const csvFormat = dsvFormat(';').format
const {timeFormat, formatPrice} = require('../../../lib/formats')
const Roles = require('../../../lib/Roles')

const dateTimeFormat = timeFormat('%x %H:%M') // %x - the locale’s date

module.exports = async (_, args, {pgdb, user}) => {
  Roles.ensureUserHasRole(user, 'accountant')

  let {paymentIds} = args
  if (!paymentIds) {
    paymentIds = await pgdb.queryOneColumn(`SELECT id FROM payments`)
  }

  const goodies = await pgdb.public.goodies.findAll()
  const membershipTypes = await pgdb.public.membershipTypes.findAll()
  const rewards = (await pgdb.public.rewards.findAll()).map(reward => {
    const goodie = goodies.find(g => g.rewardId === reward.id)
    const membershipType = membershipTypes.find(m => m.rewardId === reward.id)
    if (goodie) {
      return Object.assign({}, reward, {
        goodie,
        name: goodie.name
      })
    } else {
      return Object.assign({}, reward, {
        membershipType,
        name: membershipType.name
      })
    }
  })
  const pkgOptions = (await pgdb.public.packageOptions.findAll()).map(pkgOption =>
      Object.assign({}, pkgOption, {
        reward: rewards.find(r => r.id === pkgOption.rewardId)
      })
  )
  const aboPkgo = pkgOptions.filter(pkgo =>
      (pkgo.reward && pkgo.reward.name === 'ABO')
  )
  const aboBenefactorPkgos = pkgOptions.filter(pkgo =>
      (pkgo.reward && pkgo.reward.name === 'BENEFACTOR_ABO')
  )
  const notebookPkgos = pkgOptions.filter(pkgo =>
      (pkgo.reward && pkgo.reward.name === 'NOTEBOOK')
  )
  const donationPkgos = pkgOptions.filter(pkgo => !pkgo.reward)

  const payments = (await pgdb.query(`
    SELECT
      pay.id AS "paymentId",
      p.id AS "pledgeId",
      u.id AS "userId",
      u.email AS "email",
      u."firstName" AS "firstName",
      u."lastName" AS "lastName",
      p.status AS "pledgeStatus",
      p."createdAt" AS "pledgeCreatedAt",
      pay.method AS "paymentMethod",
      pay.status AS "paymentStatus",
      p.donation AS "donation",
      p.total AS "pledgeTotal",
      pay.total AS "paymentTotal",
      pay."updatedAt" AS "paymentUpdatedAt",
      array_to_json(array_agg(po)) AS "pledgeOptions"
    FROM
      payments pay
    JOIN
      "pledgePayments" pp
      ON pay.id = pp."paymentId"
    JOIN
      pledges p
      ON pp."pledgeId" = p.id
    JOIN
      "pledgeOptions" po
      ON p.id = po."pledgeId"
    JOIN
      users u
      ON p."userId" = u.id
    WHERE
      ARRAY[pay.id] && :paymentIds
    GROUP BY
      pay.id, p.id, u.id
    ORDER BY
      u.email
  `, {
    paymentIds
  })).map(result => {
    const {pledgeOptions} = result

    const abos = pledgeOptions.filter(plo =>
      !!aboPkgo.find(pko => pko.id === plo.templateId)
    )

    // the only way to determine if the abo was reduced
    // is to check if pledge.donation is < 0
    // If that's the case, it's the only product
    // bought in that pledge.
    const regularAbos = result.donation >= 0
      ? abos
      : []
    const reducedAbos = result.donation < 0
      ? abos
      : []

    const benefactorAbos = pledgeOptions.filter(plo =>
      !!aboBenefactorPkgos.find(pko => pko.id === plo.templateId)
    )
    const notebooks = pledgeOptions.filter(plo =>
      !!notebookPkgos.find(pko => pko.id === plo.templateId)
    )

    const donations = pledgeOptions.filter(plo =>
      !!donationPkgos.find(pko => pko.id === plo.templateId)
    )
    const numDonations = donations.reduce((sum, d) => sum + d.amount, 0)
    const donation = numDonations > 0
      ? result.donation + 100 // minPrice of donation is 1
      : result.donation

    return {
      paymentId: result.paymentId.substring(0, 13),
      pledgeId: result.pledgeId.substring(0, 13),
      userId: result.userId.substring(0, 13),
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      pledgeStatus: result.pledgeStatus,
      pledgeCreatedAt: dateTimeFormat(result.pledgeCreatedAt),
      pledgeTotal: formatPrice(result.pledgeTotal),
      paymentMethod: result.paymentMethod,
      paymentStatus: result.paymentStatus,
      paymentTotal: formatPrice(result.paymentTotal),
      paymentUpdatedAt: dateTimeFormat(result.paymentUpdatedAt),
      'ABO #': regularAbos.reduce((sum, d) => sum + d.amount, 0),
      'ABO total': formatPrice(regularAbos.reduce((sum, d) => sum + d.price, 0)),
      'ABO_REDUCED #': reducedAbos.reduce((sum, d) => sum + d.amount, 0),
      'ABO_REDUCED total': formatPrice(reducedAbos.reduce((sum, d) => sum + d.price, 0)),
      'ABO_BENEFACTOR #': benefactorAbos.reduce((sum, d) => sum + d.amount, 0),
      'ABO_BENEFACTOR total': formatPrice(benefactorAbos.reduce((sum, d) => sum + d.price, 0)),
      'NOTEBOOK #': notebooks.reduce((sum, d) => sum + d.amount, 0),
      'NOTEBOOK total': formatPrice(notebooks.reduce((sum, d) => sum + d.price, 0)),
      'DONATION #': numDonations,
      // 'DONATION total': formatPrice(donations.reduce((sum, d) => sum + d.price, 0)),
      donation: formatPrice(donation)
    }
  })

  return csvFormat(payments)
}
