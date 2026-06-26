import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Update / delete a single knowledge base. Both run through the
// caller's RLS-scoped client: the knowledge_bases_update /
// knowledge_bases_delete policies restrict these to account admins and
// scope the row to the caller's account, so no explicit ownership
// check is needed here.

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
  if (typeof body.content === 'string') update.content = body.content

  const { data, error } = await supabase
    .from('knowledge_bases')
    .update(update)
    .eq('id', id)
    .select('id, name, content, created_at, updated_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ knowledge_base: data })
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

  const { error } = await supabase.from('knowledge_bases').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ ok: true })
}
