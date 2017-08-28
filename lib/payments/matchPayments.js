const generateMemberships = require('../generateMemberships')
const sendPaymentSuccessful = require('./sendPaymentSuccessful')

module.exports = async (transaction, t) => {
  // load
  const unmatchedPayments = await transaction.public.postfinancePayments.find({
    matched: false
  })
  const payments = await transaction.public.payments.find({
    method: 'PAYMENTSLIP',
    status: 'WAITING'
  })

  // match and update payments
  let matchedPaymentIds = []
  const updatedPayments = payments.map(payment => {
    const matchingPayment = unmatchedPayments.find(up => up.mitteilung === payment.hrid)
    if (!matchingPayment) { return null }
    matchedPaymentIds.push(matchingPayment.id)

    return Object.assign({}, payment, {
      total: matchingPayment.gutschrift,
      pspPayload: matchingPayment.avisierungstext,
      status: 'PAID',
      updatedAt: new Date()
    })
  }).filter(Boolean)

  let numUpdatedPledges = 0
  let numPaymentsSuccessful = 0
  if (updatedPayments.length > 0) { // else we are done
    // write updatedPayments and matchedPayments
    await Promise.all(updatedPayments.map(payment => {
      return transaction.public.payments.update({id: payment.id}, payment)
    }))
    await transaction.public.postfinancePayments.update({id: matchedPaymentIds}, {matched: true})

    // update pledges
    const pledgePayments = await transaction.public.pledgePayments.find({
      paymentId: updatedPayments.map(p => p.id)
    })
    const pledges = await transaction.public.pledges.find({
      id: pledgePayments.map(p => p.pledgeId)
    })

    for (let payment of updatedPayments) {
      const pledgePayment = pledgePayments.find(p => p.paymentId === payment.id)
      const pledge = pledges.find(p => p.id === pledgePayment.pledgeId)
      if (!pledgePayment || !pledge) { throw new Error('could not find pledge for payment') }

      let newStatus
      if (payment.total >= pledge.total) {
        newStatus = 'SUCCESSFUL'
      } else {
        newStatus = 'PAID_INVESTIGATE'
      }

      if (pledge.status !== newStatus) {
        if (newStatus === 'SUCCESSFUL') {
          await generateMemberships(pledge.id, transaction, t)
        }
        await transaction.public.pledges.update({id: pledge.id}, {
          status: newStatus
        })
        numUpdatedPledges += 1
      }

      if (newStatus === 'SUCCESSFUL') {
        await sendPaymentSuccessful(pledge.id, transaction, t)
        numPaymentsSuccessful += 1
      }
    }
  }
  return {
    numMatchedPayments: updatedPayments.length,
    numUpdatedPledges,
    numPaymentsSuccessful
  }
}
