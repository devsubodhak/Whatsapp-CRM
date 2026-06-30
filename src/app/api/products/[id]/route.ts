import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Update / delete a catalog product. Admin-gated and account-scoped by
// the products RLS policies, so no explicit ownership check is needed.

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

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
    update.name = name
  }
  if ('description' in body) update.description = body.description ?? null
  if ('currency' in body && typeof body.currency === 'string') update.currency = body.currency
  if ('active' in body) update.active = !!body.active
  if ('image_url' in body)
    update.image_url = typeof body.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null
  if ('video_url' in body)
    update.video_url = typeof body.video_url === 'string' && body.video_url.trim() ? body.video_url.trim() : null
  if ('unit_price' in body) {
    const unitPrice = Number(body.unit_price)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'unit_price must be a non-negative number' }, { status: 400 })
    }
    update.unit_price = unitPrice
  }

  const { data, error } = await supabase
    .from('products')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ ok: true })
}
