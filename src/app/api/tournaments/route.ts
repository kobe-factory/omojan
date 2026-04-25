import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { nanoid } from 'nanoid'

export async function POST(request: Request) {
  const { mode, required_players, game_count, cards_per_user, hand_cards_per_player } = await request.json()

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
