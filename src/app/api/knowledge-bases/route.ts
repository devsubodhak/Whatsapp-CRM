import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Knowledge bases back the AI Reply automation step (see
// supabase/migrations/027_knowledge_bases.sql). These routes use the
// caller's RLS-scoped client, so the account_id filter and admin-only
// write policies are enforced by the database, not re-implemented here.

// Cap the content size. The whole knowledge base is sent to the model
// as input tokens on EVERY inbound message, so an unbounded blob is a
// cost-amplification + latency footgun. ~200k chars is generous for a
// price list / FAQ while staying well inside the model context window.
export const MAX_KB_CONTENT_CHARS = 200_000

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('id, name, content, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ knowledge_bases: data ?? [] })
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
  const content = typeof body.content === 'string' ? body.content : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (content.length > MAX_KB_CONTENT_CHARS) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_KB_CONTENT_CHARS.toLocaleString()} characters` },
      { status: 400 },
    )
  }

  // INSERT is gated to admins by the knowledge_bases_insert RLS policy;
  // a non-admin caller gets a policy violation surfaced as the error.
  const { data, error } = await supabase
    .from('knowledge_bases')
    .insert({ account_id: accountId, user_id: user.id, name, content })
    .select('id, name, content, created_at, updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 403 })
  return NextResponse.json({ knowledge_base: data }, { status: 201 })
}
