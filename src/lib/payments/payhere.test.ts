import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  formatAmount,
  computeCheckoutHash,
  verifyNotifySignature,
  mapStatusCode,
} from './payhere'

const MERCHANT_ID = '1236580'
const SECRET = 'test-secret'

function md5Upper(s: string): string {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase()
}

describe('formatAmount', () => {
  it('formats to 2 decimals with no grouping', () => {
    expect(formatAmount(1000)).toBe('1000.00')
    expect(formatAmount(1234567.5)).toBe('1234567.50')
    expect(formatAmount(0)).toBe('0.00')
    expect(formatAmount(99.999)).toBe('100.00')
  })
})

describe('computeCheckoutHash', () => {
  it('matches the PayHere formula', () => {
    const orderId = 'order-1'
    const amount = 2500
    const currency = 'LKR'
    const expected = md5Upper(
      MERCHANT_ID + orderId + '2500.00' + currency + md5Upper(SECRET),
    )
    expect(
      computeCheckoutHash({
        merchantId: MERCHANT_ID,
        merchantSecret: SECRET,
        orderId,
        amount,
        currency,
      }),
    ).toBe(expected)
  })
})

describe('verifyNotifySignature', () => {
  const base = {
    merchantId: MERCHANT_ID,
    merchantSecret: SECRET,
    orderId: 'order-1',
    payhereAmount: '2500.00',
    payhereCurrency: 'LKR',
    statusCode: '2',
  }
  const validSig = md5Upper(
    base.merchantId +
      base.orderId +
      base.payhereAmount +
      base.payhereCurrency +
      base.statusCode +
      md5Upper(SECRET),
  )

  it('accepts a correct signature', () => {
    expect(verifyNotifySignature({ ...base, md5sig: validSig })).toBe(true)
  })

  it('accepts a lowercase signature (PayHere casing tolerance)', () => {
    expect(verifyNotifySignature({ ...base, md5sig: validSig.toLowerCase() })).toBe(true)
  })

  it('rejects a tampered amount', () => {
    expect(
      verifyNotifySignature({ ...base, payhereAmount: '1.00', md5sig: validSig }),
    ).toBe(false)
  })

  it('rejects a forged signature', () => {
    expect(verifyNotifySignature({ ...base, md5sig: 'deadbeef' })).toBe(false)
  })

  it('fails closed when the secret is empty', () => {
    expect(
      verifyNotifySignature({ ...base, merchantSecret: '', md5sig: validSig }),
    ).toBe(false)
  })

  it('fails closed when md5sig is empty', () => {
    expect(verifyNotifySignature({ ...base, md5sig: '' })).toBe(false)
  })
})

describe('mapStatusCode', () => {
  it('maps PayHere codes', () => {
    expect(mapStatusCode('2')).toBe('SUCCESS')
    expect(mapStatusCode('0')).toBe('PENDING_PAYMENT')
    expect(mapStatusCode('-1')).toBe('FAILED')
    expect(mapStatusCode('-2')).toBe('FAILED')
    expect(mapStatusCode('-3')).toBe('FAILED')
  })
})
