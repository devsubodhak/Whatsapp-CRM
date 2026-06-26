import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'

/**
 * Drain due `scheduled_messages` rows and send them via Meta. Meant to
 * be hit on a schedule (Vercel Cron / external pinger), gated by the
 * shared `x-cron-secret` header matching `AUTOMATION_CRON_SECRET` — the
 * same secret the automations cron uses, so operators configure one
 * pinger, not two.
 *
 * The claim step (status 'scheduled' → 'sending') is a lightweight lock
 * so overlapping invocations don't double-send. Each send is wrapped:
 * a Meta failure (e.g. the 24-hour service window closed and free text
 * was rejected) marks the row 'failed' with the reason rather than
 * crashing the batch.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (request.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('scheduled_messages')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let sent = 0
  let failed = 0

  for (const row of due) {
    // Claim the row. If another invocation grabbed it first, skip.
    const { data: claim } = await admin
      .from('scheduled_messages')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      let whatsappMessageId: string
      if (row.message_type === 'template') {
        const variables = (row.template_variables ?? {}) as Record<string, string>
        // Positional template params in strict numeric order — same rule
        // as the automation engine's send_template step.
        const params = Object.keys(variables)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => String(variables[k]))
        const res = await engineSendTemplate({
          accountId: row.account_id,
          userId: row.user_id ?? '',
          conversationId: row.conversation_id,
          contactId: row.contact_id,
          templateName: row.template_name,
          language: row.template_language ?? 'en_US',
          params,
          senderType: 'agent',
          senderId: row.user_id ?? null,
        })
        whatsappMessageId = res.whatsapp_message_id
      } else {
        const res = await engineSendText({
          accountId: row.account_id,
          userId: row.user_id ?? '',
          conversationId: row.conversation_id,
          contactId: row.contact_id,
          text: row.content_text ?? '',
          senderType: 'agent',
          senderId: row.user_id ?? null,
        })
        whatsappMessageId = res.whatsapp_message_id
      }

      await admin
        .from('scheduled_messages')
        .update({
          status: 'sent',
          sent_message_id: whatsappMessageId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await admin
        .from('scheduled_messages')
        .update({
          status: 'failed',
          error_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ processed: sent + failed, sent, failed })
}
