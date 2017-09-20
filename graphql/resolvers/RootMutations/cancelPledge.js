const Roles = require('../../../lib/Roles')
const logger = require('../../../lib/logger')
const updateUserOnMailchimp = require('../../../lib/updateUserOnMailchimp')

module.exports = async (_, args, {pgdb, req, t}) => {
  Roles.ensureUserHasRole(req.user, 'supporter')
  const { pledgeId } = args
  const { PARKING_PLEDGE_ID, PARKING_USER_ID } = process.env
  const now = new Date()
  const transaction = await pgdb.transactionBegin()
  try {
    const pledge = await transaction.public.pledges.findOne({id: pledgeId})
    if (!pledge) {
      logger.error('pledge not found', { req: req._log(), pledgeId })
      throw new Error(t('api/pledge/404'))
    }
    if (pledge.id === PARKING_PLEDGE_ID || pledge.userId === PARKING_USER_ID) {
      const message = 'pledge PARKING_PLEDGE_ID by PARKING_USER_ID can not be cancelled'
      logger.error(message, { req: req._log(), pledge })
      throw new Error(message)
    }
    await transaction.public.pledges.updateOne({id: pledgeId}, {
      status: 'CANCELLED',
      updatedAt: now
    })

    const payments = await transaction.query(`
      SELECT
        pay.*
      FROM
        payments pay
      JOIN
        "pledgePayments" pp
        ON pp."paymentId" = pay.id
      JOIN
        pledges p
        ON pp."pledgeId" = p.id
      WHERE
        p.id = :pledgeId
    `, {
      pledgeId
    })

    for (let payment of payments) {
      let newStatus
      switch (payment.status) {
        case 'WAITING':
          newStatus = 'CANCELLED'
          break
        case 'PAID':
          newStatus = 'WAITING_FOR_REFUND'
          break
        default:
          newStatus = payment.status
      }
      if (newStatus !== payment.status) {
        await transaction.public.payments.updateOne({
          id: payment.id
        }, {
          status: newStatus,
          updatedAt: now
        })
      }
    }

    await transaction.public.memberships.update({
      pledgeId: pledgeId
    }, {
      pledgeId: PARKING_PLEDGE_ID,
      userId: PARKING_USER_ID,
      updatedAt: now
    })

    await transaction.transactionCommit()

    await updateUserOnMailchimp({
      userId: pledge.userId,
      pgdb
    })
  } catch (e) {
    await transaction.transactionRollback()
    logger.info('transaction rollback', { req: req._log(), args, error: e })
    throw e
  }

  return pgdb.public.pledges.findOne({id: pledgeId})
}
