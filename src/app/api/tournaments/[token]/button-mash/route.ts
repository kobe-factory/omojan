import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const { game_id, user_id, tap_count, mash_round } = await request.json()

  if (!game_id || !user_id || tap_count == null) {
    return NextResponse.json({ error: 'パラメータが不足しています' }, { status: 400 })
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  const round = mash_round ?? 1

  // UPSERT: 同じ game_id + user_id + mash_round は上書き
  const { error } = await supabaseAdmin
    .from('button_mash_results')
    .upsert(
      { game_id, user_id, tap_count, mash_round: round },
      { onConflict: 'game_id,user_id,mash_round' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ saved: true })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const { searchParams } = new URL(request.url)
  const game_id = searchParams.get('game_id')

  if (!game_id) {
    return NextResponse.json({ error: 'game_id が必要です' }, { status: 400 })
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  const { data: results } = await supabase
    .from('button_mash_results')
    .select('user_id, tap_count, mash_round, completed_at')
    .eq('game_id', game_id)
    .order('mash_round', { ascending: false })
    .order('completed_at', { ascending: true })

  return NextResponse.json({ results: results ?? [] })
}
