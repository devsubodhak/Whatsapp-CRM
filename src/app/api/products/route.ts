import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Product catalog backing AI Checkout (migration 029). The AI gathers
// what the customer wants; the server prices it from THIS table, never
// from the model. RLS scopes reads to members and writes to admins.

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const unitPrice = Number(body.unit_price)
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return NextResponse.json({ error: 'unit_price must be a non-negative number' }, { status: 400 })
  }

  // INSERT is admin-gated by RLS; a non-admin gets a policy error.
  const { data, error } = await supabase
    .from('products')
    .insert({
      account_id: accountId,
      name,
      description: typeof body.description === 'string' ? body.description : null,
      unit_price: unitPrice,
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'LKR',
      active: body.active === undefined ? true : !!body.active,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ product: data }, { status: 201 })
}
