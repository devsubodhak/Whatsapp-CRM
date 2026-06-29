import crypto from 'node:crypto'

// ------------------------------------------------------------
// PayHere helpers — checkout hash generation + notify-callback
// signature verification.
//
// PayHere authenticates both directions with an MD5 scheme keyed on the
// merchant secret:
//   checkout hash = UPPER( md5( merchant_id + order_id + amount + currency
//                               + UPPER(md5(merchant_secret)) ) )
//   notify md5sig = UPPER( md5( merchant_id + order_id + payhere_amount
//                               + payhere_currency + status_code
//                               + UPPER(md5(merchant_secret)) ) )
//
// Docs: https://support.payhere.lk/api-&-mobile-sdk/checkout-api
// ------------------------------------------------------------

function md5Upper(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase()
}

/** PayHere wants the amount with exactly 2 decimals and no thousands
 *  separators (e.g. 1000 → "1000.00"). The hash must use this exact
 *  string, so checkout and verification share this formatter. */
export function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  })
}

export interface CheckoutHashInput {
  merchantId: string
  merchantSecret: string
  orderId: string
  amount: number
  currency: string
}

/** Hash that goes into the checkout form so PayHere trusts the amount. */
export function computeCheckoutHash(input: CheckoutHashInput): string {
  const secretHash = md5Upper(input.merchantSecret)
  return md5Upper(
    input.merchantId + input.orderId + formatAmount(input.amount) + input.currency + secretHash,
  )
}

export interface NotifySignatureInput {
  merchantId: string
  merchantSecret: string
  orderId: string
  /** `payhere_amount` exactly as PayHere sent it (already 2-dp string). */
  payhereAmount: string
  payhereCurrency: string
  statusCode: string
  /** The `md5sig` field from the callback. */
  md5sig: string
}

/**
 * Verify a PayHere notify callback really came from PayHere. Returns
 * false (fails closed) if anything is missing, so a misconfigured
 * secret can't be exploited as an "always valid" path. Constant-time
 * compare avoids leaking the expected signature via timing.
 */
export function verifyNotifySignature(input: NotifySignatureInput): boolean {
  if (!input.merchantSecret || !input.md5sig) return false
  const secretHash = md5Upper(input.merchantSecret)
  const expected = md5Upper(
    input.merchantId +
      input.orderId +
      input.payhereAmount +
      input.payhereCurrency +
      input.statusCode +
      secretHash,
  )
  const a = Buffer.from(expected)
  const b = Buffer.from(input.md5sig.toUpperCase())
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** PayHere status_code → our order status. 2 = success, 0 = pending,
 *  -1 cancelled, -2 failed, -3 chargeback. */
export function mapStatusCode(statusCode: string): 'SUCCESS' | 'PENDING_PAYMENT' | 'FAILED' {
  if (statusCode === '2') return 'SUCCESS'
  if (statusCode === '0') return 'PENDING_PAYMENT'
  return 'FAILED'
}

export interface PayHereConfig {
  merchantId: string
  merchantSecret: string
  sandbox: boolean
}

/** Read + validate PayHere config from the environment. Throws a clear
 *  error when unset so the failure is a 500 with a useful message rather
 *  than a malformed checkout. */
export function getPayHereConfig(): PayHereConfig {
  const merchantId = process.env.PAYHERE_MERCHANT_ID
  const merchantSecret = process.env.PAYHERE_MERCHANT_SECRET
  if (!merchantId || !merchantSecret) {
    throw new Error('PayHere is not configured (PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET).')
  }
  return {
    merchantId,
    merchantSecret,
    // Anything other than an explicit "false" stays in the safe sandbox.
    sandbox: process.env.PAYHERE_SANDBOX !== 'false',
  }
}

export const PAYHERE_CHECKOUT_URL = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const
