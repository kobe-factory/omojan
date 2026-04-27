import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

export async function POST(request: Request) {
  const { mode, required_players, game_count, cards_per_user, hand_cards_per_player } = await request.json()

  if (mode === 'production') {
    const { data: active } = await supabase
      .from('tournaments')
      .select('id')
      .eq('mode', 'production')
      .in('status', ['waiting_users', 'creating_cards', 'playing'])
      .limit(1)
      .maybeSingle()

    if (active) {
      return NextResponse.json({ error: '進行中の本番大会があります。終了後に発行してください。' }, { status: 409 })
    }
  }

  const token = nanoid(10)

  const { data, error } = await supabase
    .from('tournaments')
    .insert({ token, mode: mode ?? 'production', required_players, game_count, cards_per_user, hand_cards_per_player })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ token: data.token })
}
