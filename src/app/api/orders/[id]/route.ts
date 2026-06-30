import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { engineSendText } from '@/lib/automations/meta-send'

// Toggle the admin "confirmed" checkbox on an order. The orders table is
// read-only under RLS (writes are server-driven), so we verify ownership
// against the caller's account and then write with the service-role
// client. Confirming a bank-transfer order that's awaiting verification
// also marks it paid (SUCCESS) and notifies the customer on WhatsApp.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body.confirmed !== 'boolean') {
    return NextResponse.json({ error: 'confirmed (boolean) is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  // Ownership: the order must belong to the caller's account.
  const { data: order } = await admin
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!order || order.account_id !== accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {
    confirmed_at: body.confirmed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  // Verifying a bank-transfer slip = accepting payment → mark it paid.
  const verifiedBankTransfer =
    body.confirmed && order.status === 'AWAITING_VERIFICATION'
  if (verifiedBankTransfer) update.status = 'SUCCESS'

  const { data, error } = await admin
    .from('orders')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tell the customer their bank transfer was confirmed. Best-effort —
  // a Meta failure shouldn't fail the dashboard action.
  if (verifiedBankTransfer && order.conversation_id && order.contact_id) {
    const orderNo = order.order_number ? `#${order.order_number}` : ''
    try {
      await engineSendText({
        accountId,
        userId: user.id,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        text: `✅ *Payment confirmed* for Order ${orderNo}!\n\nThank you 🙏 We’re preparing your order now and will keep you posted. 📦`,
        senderType: 'agent',
        senderId: user.id,
      })
    } catch (err) {
      console.error('[orders] confirmation message failed:', err)
    }
  }

  return NextResponse.json({ order: data })
}
