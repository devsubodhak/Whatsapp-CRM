// ------------------------------------------------------------
// AI Checkout gateway.
//
// Called from the WhatsApp webhook for each inbound text message when
// `whatsapp_config.ai_checkout_enabled` is on. It runs the Gemini
// checkout assistant, and when the order is complete it prices it from
// the products catalog, creates an order, and sends a PayHere "Pay Now"
// button.
//
// Returns `{ consumed }`: when true, the webhook suppresses the
// content-level automation triggers (new_message_received / keyword_match)
// for this message so the AI Reply automation doesn't also respond.
//
// Never throws — the webhook is fire-and-forget. On any error it logs
// and returns consumed:false so normal processing continues.
// ------------------------------------------------------------

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTextMessage, sendCtaUrlMessage } from '@/lib/whatsapp/meta-api'
import { runCheckoutTurn, type CheckoutTurn, type CatalogEntry } from '@/lib/ai/gemini-checkout'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import type { OrderItem } from '@/types'

/** How long an unpaid order stays live before the gateway lets the
 *  customer start over (lazy expiry — no cron needed). */
const ORDER_TTL_MS = 24 * 60 * 60 * 1000

export interface CheckoutGatewayInput {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  /** Customer's WhatsApp number (E.164-ish), the Meta send target. */
  phone: string
  /** The inbound message text. */
  messageText: string
  /** An inbound media attachment, if any (used to receive bank slips). */
  media?: { url: string; type: string } | null
  phoneNumberId: string
  accessToken: string
  /** Public origin for building the payment link, e.g. https://x.ngrok.app */
  baseUrl: string
  /** Bank account details to offer for transfers (Settings → AI Assistant). */
  bankDetails?: string | null
}

export async function runCheckoutGateway(
  input: CheckoutGatewayInput,
): Promise<{ consumed: boolean }> {
  try {
    const db = supabaseAdmin()
    const text = input.messageText?.trim() ?? ''
    const isImage = !!input.media && input.media.type === 'image'
    // Nothing actionable (no text and no image) → let normal processing run.
    if (!text && !isImage) return { consumed: false }

    // Current checkout state for this conversation.
    const { data: conv } = await db
      .from('conversations')
      .select('checkout_state')
      .eq('id', input.conversationId)
      .maybeSingle()
    const state = (conv?.checkout_state as string | undefined) ?? 'IDLE'

    if (state === 'WAITING_FOR_PAYMENT') {
      const { data: pending } = await db
        .from('orders')
        .select('id, order_number, expires_at')
        .eq('conversation_id', input.conversationId)
        .eq('status', 'PENDING_PAYMENT')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Bank-transfer slip: an image while an order awaits payment is the
      // customer's proof of bank transfer. Attach it and move the order to
      // verification — an admin confirms it on the Orders dashboard.
      if (pending && isImage && input.media) {
        await db
          .from('orders')
          .update({
            status: 'AWAITING_VERIFICATION',
            payment_method: 'bank_transfer',
            slip_url: input.media.url,
            updated_at: new Date().toISOString(),
          })
          .eq('id', pending.id)
        await db
          .from('conversations')
          .update({ checkout_state: 'COMPLETED', updated_at: new Date().toISOString() })
          .eq('id', input.conversationId)
        const orderNo = pending.order_number ? `#${pending.order_number}` : ''
        await sendAndLog(
          db,
          input,
          `✅ Thanks! We’ve received your payment slip for *Order ${orderNo}*.\n\n• Our team will verify it shortly 🔎\n• You’ll get a confirmation here once it’s approved 🙏`,
        )
        return { consumed: true }
      }

      const expired =
        pending?.expires_at != null && new Date(pending.expires_at).getTime() < Date.now()
      const wantsCancel = !!text && /\b(cancel|stop|reset|new order|restart)\b/i.test(text)

      // A live order is still awaiting payment and the customer isn't
      // cancelling → don't stack a new order on top. Nudge them with both
      // payment options (rather than going silent).
      if (pending && !expired && !wantsCancel) {
        const payUrl = `${input.baseUrl.replace(/\/$/, '')}/api/payments/pay?orderId=${pending.id}`
        const lines = [
          'You still have an order waiting for payment 🧾. You can:',
          '',
          `• 💳 Pay by card — tap *Pay Now* above, or open: ${payUrl}`,
        ]
        if (input.bankDetails?.trim()) {
          lines.push('• 🏦 Pay by bank transfer, then send a *photo of your slip* here 📸')
        }
        lines.push('• Reply *cancel* to start a new order')
        await sendAndLog(db, input, lines.join('\n'))
        return { consumed: true }
      }

      // Otherwise clear the lock: the order expired, was cancelled, or the
      // state was stranded with no live order.
      if (pending) {
        await db
          .from('orders')
          .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
          .eq('id', pending.id)
      }
      await db
        .from('conversations')
        .update({ checkout_state: 'IDLE', updated_at: new Date().toISOString() })
        .eq('id', input.conversationId)

      if (wantsCancel) {
        await sendAndLog(
          db,
          input,
          'No problem — I’ve cancelled that order. What would you like to order? 🙂',
        )
        return { consumed: true }
      }
      // Expired / stranded → fall through to a fresh AI turn below.
    }

    // An image outside the payment flow (no live order to attach it to)
    // and no text → the text-only assistant can't act on it.
    if (isImage && !text) return { consumed: false }

    // Per-contact throttle — every AI turn is a Gemini call. Over the limit
    // we bow out and let normal processing handle the message.
    const rl = checkRateLimit(`ai_checkout:${input.accountId}:${input.contactId}`, RATE_LIMITS.aiReply)
    if (!rl.success) return { consumed: false }

    // Load the active product catalog (for ordering) and the knowledge
    // base (for answering general business questions). With neither, the
    // assistant has nothing to work with — let normal processing handle it.
    const [{ data: productRows }, { data: kbRows }] = await Promise.all([
      db
        .from('products')
        .select('id, name, unit_price, currency, description, image_url, video_url, active')
        .eq('account_id', input.accountId)
        .eq('active', true),
      db.from('knowledge_bases').select('content').eq('account_id', input.accountId),
    ])
    const products = (productRows ?? []) as {
      id: string
      name: string
      unit_price: number
      currency: string
      description: string | null
      image_url: string | null
      video_url: string | null
    }[]
    // Concatenate all knowledge bases (capped) as the business context.
    const knowledge = (kbRows ?? [])
      .map((r) => (r.content as string | null) ?? '')
      .filter((c) => c.trim())
      .join('\n\n---\n\n')
      .slice(0, 100_000)

    if (products.length === 0 && !knowledge.trim()) return { consumed: false }

    const catalog: CatalogEntry[] = products.map((p) => ({
      name: p.name,
      unit_price: Number(p.unit_price),
      currency: p.currency,
      description: p.description,
      image_url: p.image_url,
      video_url: p.video_url,
    }))

    // Recent conversation context (oldest-first), excluding the current
    // inbound (already inserted by the webhook).
    const { data: histRows } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', input.conversationId)
      .eq('content_type', 'text')
      .order('created_at', { ascending: false })
      .limit(11)
    const history: CheckoutTurn[] = (histRows ?? [])
      .reverse()
      .slice(0, -1)
      .filter((r) => (r.content_text ?? '').trim())
      .map((r) => ({ role: r.sender_type as CheckoutTurn['role'], text: r.content_text as string }))

    // Business name for the persona (best-effort).
    const { data: account } = await db
      .from('accounts')
      .select('name')
      .eq('id', input.accountId)
      .maybeSingle()

    const result = await runCheckoutTurn({
      message: text,
      history,
      products: catalog,
      knowledge,
      businessName: (account?.name as string | undefined) ?? undefined,
    })

    if (result.kind === 'reply') {
      await sendAndLog(db, input, result.text)
      return { consumed: true }
    }

    // result.kind === 'invoice' — price it from the catalog (NOT the AI).
    const match = matchProduct(products, result.invoice.item_type)
    if (!match) {
      const names = products.map((p) => p.name).join(', ')
      await sendAndLog(
        db,
        input,
        `Sorry, I couldn't match that to a product. We offer: ${names}. Which would you like?`,
      )
      return { consumed: true }
    }

    const quantity = result.invoice.quantity
    const amount = Number((match.unit_price * quantity).toFixed(2))
    const items: OrderItem[] = [
      {
        product_id: match.id,
        name: match.name,
        quantity,
        unit_price: Number(match.unit_price),
        customization:
          result.invoice.customization_details &&
          result.invoice.customization_details.toLowerCase() !== 'none'
            ? result.invoice.customization_details
            : null,
      },
    ]

    const deliveryAddress = result.invoice.delivery_address?.trim() || null
    const customerName = result.invoice.customer_name?.trim() || null

    const { data: order, error: orderErr } = await db
      .from('orders')
      .insert({
        account_id: input.accountId,
        conversation_id: input.conversationId,
        contact_id: input.contactId,
        phone: input.phone,
        customer_name: customerName,
        delivery_address: deliveryAddress,
        delivery_phone: input.phone,
        amount,
        currency: match.currency,
        status: 'PENDING_PAYMENT',
        items,
        expires_at: new Date(Date.now() + ORDER_TTL_MS).toISOString(),
      })
      .select('id, order_number')
      .single()
    if (orderErr || !order) {
      console.error('[checkout] order insert failed:', orderErr)
      return { consumed: false }
    }

    await db
      .from('conversations')
      .update({ checkout_state: 'WAITING_FOR_PAYMENT', updated_at: new Date().toISOString() })
      .eq('id', input.conversationId)

    const payUrl = `${input.baseUrl.replace(/\/$/, '')}/api/payments/pay?orderId=${order.id}`
    const orderNo = order.order_number ? `#${order.order_number}` : ''
    const lines = [
      `🧾 *Order ${orderNo}*`,
      '',
      `📦 *Item:* ${match.name}`,
      `🔢 *Qty:* ${quantity}`,
    ]
    if (items[0].customization) lines.push(`🎨 *Customization:* ${items[0].customization}`)
    if (customerName) lines.push(`👤 *Name:* ${customerName}`)
    if (deliveryAddress) lines.push(`📍 *Deliver to:* ${deliveryAddress}`)
    lines.push('', `💰 *Total:* ${match.currency} ${amount.toLocaleString()}`)
    lines.push('', '*How would you like to pay?*')
    lines.push('• 💳 *Card* — tap *Pay Now* below')
    if (input.bankDetails?.trim()) {
      lines.push('• 🏦 *Bank transfer:*')
      lines.push(input.bankDetails.trim())
      lines.push('…then send a *photo of your slip* here and we’ll verify it 📸')
    }
    const bodyText = lines.join('\n')

    try {
      const { messageId } = await sendCtaUrlMessage({
        phoneNumberId: input.phoneNumberId,
        accessToken: input.accessToken,
        to: input.phone,
        bodyText,
        buttonText: 'Pay Now 💳',
        url: payUrl,
      })
      await logBotMessage(db, input.conversationId, bodyText, messageId)
    } catch (err) {
      console.error('[checkout] cta send failed, falling back to link text:', err)
      // Fallback: some numbers / clients don't render cta_url — send the
      // link as plain text so the customer can still pay.
      await sendAndLog(db, input, `${bodyText}\n\nPay here: ${payUrl}`)
    }

    return { consumed: true }
  } catch (err) {
    console.error('[checkout] gateway error:', err)
    return { consumed: false }
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

interface ProductRow {
  id: string
  name: string
  unit_price: number
  currency: string
}

/** Best-effort match of the AI's item_type to a catalog product:
 *  exact (case-insensitive) first, then substring either direction. */
function matchProduct(products: ProductRow[], itemType: string): ProductRow | null {
  const needle = itemType.trim().toLowerCase()
  if (!needle) return null
  const exact = products.find((p) => p.name.toLowerCase() === needle)
  if (exact) return exact
  const contains = products.find(
    (p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()),
  )
  return contains ?? null
}

async function sendAndLog(
  db: ReturnType<typeof supabaseAdmin>,
  input: CheckoutGatewayInput,
  text: string,
): Promise<void> {
  const { messageId } = await sendTextMessage({
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
    to: input.phone,
    text,
  })
  await logBotMessage(db, input.conversationId, text, messageId)
}

async function logBotMessage(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  text: string,
  whatsappMessageId: string,
): Promise<void> {
  await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text,
    message_id: whatsappMessageId,
    status: 'sent',
  })
  await db
    .from('conversations')
    .update({ last_message_text: text, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversationId)
}
