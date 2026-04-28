import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params
  const { line_user_id } = await request.json()
  if (!line_user_id) return NextResponse.json({ error: 'line_user_id is required' }, { status: 400 })

  const { data: user } = await supabase
    .from('users')
    .select('line_user_id')
    .eq('id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })
  if (user.line_user_id) return NextResponse.json({ ok: true, skipped: true })

  const { error } = await supabase
    .from('users')
    .update({ line_user_id })
    .eq('id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
