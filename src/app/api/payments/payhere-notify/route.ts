import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import {
  verifyNotifySignature,
  formatAmount,
  mapStatusCode,
  getPayHereConfig,
} from '@/lib/payments/payhere'

// POST /api/payments/payhere-notify
//
// Server-to-server callback from PayHere. This is the ONLY thing that
// marks an order paid, so it's security-load-bearing:
//   1. Verify the md5sig (fails closed) — proves it's really PayHere.
//   2. Idempotent — a replayed callback never double-confirms.
//   3. Amount/currency must match the order — blocks underpayment.
// Always ack 200 so PayHere doesn't retry a request we deliberately
// ignored (forged / stale / duplicate).

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let config
  try {
    config = getPayHereConfig()
  } catch {
    // No secret configured → we cannot trust anything. Fail closed.
    console.error('[payhere-notify] PayHere not configured; rejecting callback')
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ ok: true })

  const get = (k: string) => String(form.get(k) ?? '')
  const merchantId = get('merchant_id')
  const orderId = get('order_id')
  const payhereAmount = get('payhere_amount')
  const payhereCurrency = get('payhere_currency')
  const statusCode = get('status_code')
  const md5sig = get('md5sig')
  const paymentId = get('payment_id')

  // 1. Authenticity.
  const valid = verifyNotifySignature({
    merchantId,
    merchantSecret: config.merchantSecret,
    orderId,
    payhereAmount,
    payhereCurrency,
    statusCode,
    md5sig,
  })
  if (!valid) {
    console.warn('[payhere-notify] invalid signature for order', orderId)
    // Ack so PayHere stops retrying a request we will never honour.
    return NextResponse.json({ ok: true })
  }

  const db = supabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, account_id, conversation_id, contact_id, phone, amount, currency, status')
    .eq('id', orderId)
    .maybeSingle()
  if (!order) {
    console.warn('[payhere-notify] unknown order', orderId)
    return NextResponse.json({ ok: true })
  }

  // 2. Idempotency — already settled, do nothing.
  if (order.status === 'SUCCESS' || order.status === 'FAILED') {
    return NextResponse.json({ ok: true })
  }

  const mapped = mapStatusCode(statusCode)

  if (mapped === 'SUCCESS') {
    // 3. Amount + currency integrity — a valid signature on a tampered
    // amount shouldn't settle the order for less than it's worth.
    if (payhereAmount !== formatAmount(Number(order.amount)) || payhereCurrency !== order.currency) {
      console.error(
        '[payhere-notify] amount/currency mismatch',
        { orderId, payhereAmount, payhereCurrency, expected: formatAmount(Number(order.amount)), currency: order.currency },
      )
      return NextResponse.json({ ok: true })
    }

    await db
      .from('orders')
      .update({ status: 'SUCCESS', payhere_ref: paymentId || null, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'PENDING_PAYMENT') // guard against a race
    if (order.conversation_id) {
      await db
        .from('conversations')
        .update({ checkout_state: 'COMPLETED', updated_at: new Date().toISOString() })
        .eq('id', order.conversation_id)
    }
    await sendConfirmation(order, true)
    return NextResponse.json({ ok: true })
  }

  if (mapped === 'FAILED') {
    await db
      .from('orders')
      .update({ status: 'FAILED', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'PENDING_PAYMENT')
    // Free the conversation so the customer can try again.
    if (order.conversation_id) {
      await db
        .from('conversations')
        .update({ checkout_state: 'IDLE', updated_at: new Date().toISOString() })
        .eq('id', order.conversation_id)
    }
    await sendConfirmation(order, false)
    return NextResponse.json({ ok: true })
  }

  // PENDING (status 0) — leave the order as-is, await a later callback.
  return NextResponse.json({ ok: true })
}

interface OrderForConfirm {
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  phone: string
  amount: number
  currency: string
}

/** Send a WhatsApp confirmation (or failure note) and log it. Best
 *  effort — a Meta failure (e.g. the 24h window closed) is logged but
 *  never fails the callback, which has already settled the order. */
async function sendConfirmation(order: OrderForConfirm, success: boolean): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: cfg } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token, post_purchase_message')
      .eq('account_id', order.account_id)
      .maybeSingle()
    if (!cfg?.access_token) return

    const accessToken = decrypt(cfg.access_token)
    const shortId = order.id.slice(0, 8)
    const text = success
      ? `✅ Your payment was successful! Your Order ID is #${shortId}. Thank you for your order — we’ll be in touch shortly.`
      : `⚠️ Your payment for order #${shortId} didn’t go through. No charge was made — reply here and we’ll help you complete it.`

    const { messageId } = await sendTextMessage({
      phoneNumberId: cfg.phone_number_id,
      accessToken,
      to: order.phone,
      text,
    })

    if (order.conversation_id) {
      await db.from('messages').insert({
        conversation_id: order.conversation_id,
        sender_type: 'bot',
        content_type: 'text',
        content_text: text,
        message_id: messageId,
        status: 'sent',
      })
      await db
        .from('conversations')
        .update({ last_message_text: text, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', order.conversation_id)
    }

    // Configured post-purchase follow-up (thank-you / review link).
    if (success) {
      const postMsg = (cfg as { post_purchase_message?: string | null }).post_purchase_message?.trim()
      if (postMsg) {
        const { messageId: pmId } = await sendTextMessage({
          phoneNumberId: cfg.phone_number_id,
          accessToken,
          to: order.phone,
          text: postMsg,
        })
        if (order.conversation_id) {
          await db.from('messages').insert({
            conversation_id: order.conversation_id,
            sender_type: 'bot',
            content_type: 'text',
            content_text: postMsg,
            message_id: pmId,
            status: 'sent',
          })
        }
      }
    }
  } catch (err) {
    console.error('[payhere-notify] confirmation send failed:', err)
  }
}
