import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Toggle the admin "confirmed" checkbox on an order. The orders table is
// read-only under RLS (writes are server-driven), so we verify ownership
// against the caller's account and then write with the service-role
// client.

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
    .select('id, account_id')
    .eq('id', id)
    .maybeSingle()
  if (!order || order.account_id !== accountId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('orders')
    .update({
      confirmed_at: body.confirmed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ order: data })
}
