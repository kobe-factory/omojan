import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { user_id, game_id, hand_card_id, position, preamble } = await request.json()

  const { data: game } = await supabase
    .from('games')
    .select('id, status')
    .eq('id', game_id)
    .single()

  if (!game || game.status !== 'waiting_submission') {
    return NextResponse.json({ error: '作品投稿フェーズではありません' }, { status: 400 })
  }

  // 既存の投稿を削除して作り直し（修正対応）
  await supabase.from('submissions').delete().eq('game_id', game_id).eq('user_id', user_id)

  const { error } = await supabase.from('submissions').insert({
    game_id,
    user_id,
    hand_card_id,
    position,
    preamble: preamble || null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 手札を使用済みにする
  await supabase
    .from('player_hands')
    .update({ is_used: true })
    .eq('card_id', hand_card_id)
    .eq('user_id', user_id)

  return NextResponse.json({ success: true })
}
