import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Cancel a scheduled message. Hard-deletes the row via the caller's
// RLS-scoped client (the delete policy scopes it to the account). Only
// a still-pending row can be cancelled — once the cron has claimed it
// (status 'sending') or sent it, there's nothing to call back.

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

  const { data, error } = await supabase
    .from('scheduled_messages')
    .delete()
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    // Either it doesn't exist / isn't ours (RLS), or it already left the
    // 'scheduled' state (being sent / sent / failed).
    return NextResponse.json(
      { error: 'Not found or already being sent' },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true })
}
