import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { user_id } = await request.json()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, game_count, cards_per_user')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  if (tournament.status !== 'waiting_users') {
    return NextResponse.json({ error: '参加受付は終了しています' }, { status: 400 })
  }

  const { error } = await supabase
    .from('tournament_participants')
    .insert({ tournament_id: tournament.id, user_id })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { user_id } = await request.json()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  if (tournament.status !== 'waiting_users') {
    return NextResponse.json({ error: '参加受付は終了しています' }, { status: 400 })
  }

  const { error } = await supabase
    .from('tournament_participants')
    .delete()
    .eq('tournament_id', tournament.id)
    .eq('user_id', user_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
