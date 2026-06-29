import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  computeCheckoutHash,
  formatAmount,
  getPayHereConfig,
  PAYHERE_CHECKOUT_URL,
} from '@/lib/payments/payhere'

// GET /api/payments/pay?orderId=...
//
// The target of the WhatsApp "Pay Now" button. Looks the order up,
// computes the PayHere checkout hash from the DB amount (never a query
// param, so the customer can't tamper the price), and returns a tiny
// auto-submitting HTML form that POSTs to PayHere's checkout. Opens
// inside WhatsApp's in-app browser.
//
// `?result=success|cancel` renders a return page PayHere redirects to.

export const dynamic = 'force-dynamic'

function html(body: string, status = 200): Response {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Payment</title></head><body style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#e5e5e5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px">${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const result = url.searchParams.get('result')

  // Return / cancel landing pages PayHere redirects the customer to.
  if (result === 'success') {
    return html(
      '<div><h2>✅ Payment received</h2><p>Thank you! You can return to WhatsApp — we’ll confirm your order there.</p></div>',
    )
  }
  if (result === 'cancel') {
    return html(
      '<div><h2>Payment cancelled</h2><p>No charge was made. You can return to WhatsApp and try again.</p></div>',
    )
  }

  const orderId = url.searchParams.get('orderId')
  if (!orderId) return html('<div><h2>Missing order</h2></div>', 400)

  let config
  try {
    config = getPayHereConfig()
  } catch {
    return html('<div><h2>Payments not configured</h2><p>The store owner hasn’t finished setting up PayHere.</p></div>', 503)
  }

  const db = supabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, amount, currency, status, phone, expires_at, items')
    .eq('id', orderId)
    .maybeSingle()

  if (!order) return html('<div><h2>Order not found</h2></div>', 404)
  if (order.status === 'SUCCESS') {
    return html('<div><h2>Already paid ✅</h2><p>This order is already complete.</p></div>')
  }
  if (order.status !== 'PENDING_PAYMENT') {
    return html('<div><h2>This order can no longer be paid</h2><p>Please start a new order in WhatsApp.</p></div>', 410)
  }
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    return html('<div><h2>This payment link has expired</h2><p>Please start a new order in WhatsApp.</p></div>', 410)
  }

  const amount = formatAmount(Number(order.amount))
  const currency = order.currency || 'LKR'
  const hash = computeCheckoutHash({
    merchantId: config.merchantId,
    merchantSecret: config.merchantSecret,
    orderId: order.id,
    amount: Number(order.amount),
    currency,
  })

  const base = `${url.protocol}//${url.host}`
  const items =
    Array.isArray(order.items) && order.items.length > 0
      ? order.items.map((i: { name?: string; quantity?: number }) => `${i.name} x${i.quantity}`).join(', ')
      : 'Order'

  const fields: Record<string, string> = {
    merchant_id: config.merchantId,
    return_url: `${base}/api/payments/pay?result=success`,
    cancel_url: `${base}/api/payments/pay?result=cancel`,
    notify_url: `${base}/api/payments/payhere-notify`,
    order_id: order.id,
    items,
    currency,
    amount,
    first_name: 'WhatsApp',
    last_name: 'Customer',
    email: 'customer@example.com',
    phone: order.phone || '',
    address: 'N/A',
    city: 'Colombo',
    country: 'Sri Lanka',
    hash,
  }

  const action = config.sandbox ? PAYHERE_CHECKOUT_URL.sandbox : PAYHERE_CHECKOUT_URL.live
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')

  return html(
    `<div>
       <h2>Redirecting to secure payment…</h2>
       <p>If it doesn’t open automatically, tap the button.</p>
       <form id="payhere" method="post" action="${esc(action)}">
         ${inputs}
         <button type="submit" style="margin-top:16px;padding:12px 24px;font-size:16px;background:#22c55e;color:#fff;border:none;border-radius:8px">Pay ${esc(currency)} ${esc(amount)}</button>
       </form>
       <script>document.getElementById('payhere').submit();</script>
     </div>`,
  )
}
