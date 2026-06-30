import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// List the account's orders for the Orders dashboard. RLS (orders_select,
// migration 029) scopes the read to the caller's account.

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ orders: data ?? [] })
}
