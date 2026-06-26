import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// Schedule a 1:1 WhatsApp message (free text or approved template) to be
// sent at a future time. Backed by scheduled_messages (migration 028)
// and drained by /api/whatsapp/schedule/cron. All queries run through
// the caller's RLS-scoped client, so account isolation is enforced by
// the database.

/** Hardest practical ceiling on how far ahead a message can be queued. */
const MAX_SCHEDULE_DAYS = 365
/** Small floor so a "schedule" isn't really an immediate send racing the cron. */
const MIN_LEAD_MS = 30_000

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const conversationId = url.searchParams.get('conversation_id')

  let query = supabase
    .from('scheduled_messages')
    .select('*')
    // Surface pending sends and recent failures; sent ones are already
    // in the message thread, so they'd be noise here.
    .in('status', ['scheduled', 'sending', 'failed'])
    .order('scheduled_at', { ascending: true })

  if (conversationId) query = query.eq('conversation_id', conversationId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled_messages: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Reuse the per-user send budget — scheduling is a send-class action.
  const limit = checkRateLimit(`schedule:${user.id}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const {
    conversation_id,
    message_type,
    content_text,
    template_name,
    template_language,
    template_variables,
    scheduled_at,
  } = body

  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }
  if (message_type !== 'text' && message_type !== 'template') {
    return NextResponse.json(
      { error: 'message_type must be "text" or "template"' },
      { status: 400 },
    )
  }
  if (message_type === 'text' && !(typeof content_text === 'string' && content_text.trim())) {
    return NextResponse.json(
      { error: 'content_text is required for text messages' },
      { status: 400 },
    )
  }
  if (message_type === 'template' && !(typeof template_name === 'string' && template_name)) {
    return NextResponse.json(
      { error: 'template_name is required for template messages' },
      { status: 400 },
    )
  }

  // Validate the scheduled time: a real, future timestamp within the cap.
  const when = new Date(scheduled_at)
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: 'scheduled_at is not a valid date' }, { status: 400 })
  }
  const leadMs = when.getTime() - Date.now()
  if (leadMs < MIN_LEAD_MS) {
    return NextResponse.json(
      { error: 'scheduled_at must be at least 30 seconds in the future' },
      { status: 400 },
    )
  }
  if (leadMs > MAX_SCHEDULE_DAYS * 86_400_000) {
    return NextResponse.json(
      { error: `scheduled_at cannot be more than ${MAX_SCHEDULE_DAYS} days ahead` },
      { status: 400 },
    )
  }

  // Confirm the conversation belongs to the caller's account and grab
  // its contact_id (the send target). RLS already scopes this select,
  // and the explicit account filter is defense in depth.
  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('id, contact_id')
    .eq('id', conversation_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
  if (!conversation?.contact_id) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('scheduled_messages')
    .insert({
      account_id: accountId,
      user_id: user.id,
      conversation_id,
      contact_id: conversation.contact_id,
      message_type,
      content_text: message_type === 'text' ? content_text : null,
      template_name: message_type === 'template' ? template_name : null,
      template_language: message_type === 'template' ? template_language ?? 'en_US' : null,
      template_variables: message_type === 'template' ? template_variables ?? null : null,
      scheduled_at: when.toISOString(),
      status: 'scheduled',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled_message: data }, { status: 201 })
}
