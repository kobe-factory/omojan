import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function DELETE() {
  // 本番以外（solo / test）の大会IDを取得
  const { data: targets, error: fetchError } = await supabase
    .from('tournaments')
    .select('id')
    .in('mode', ['solo', 'test'])

  if (fetchError) {
    return NextResponse.json({ error: `大会取得に失敗: ${fetchError.message}` }, { status: 500 })
  }

  const tournamentIds = (targets ?? []).map((t) => t.id)

  if (tournamentIds.length === 0) {
    return NextResponse.json({ success: true, deleted: 0 })
  }

  // 対象大会のgame IDを取得（votes / submissions の削除に必要）
  const { data: targetGames } = await supabase
    .from('games')
    .select('id')
    .in('tournament_id', tournamentIds)

  const gameIds = (targetGames ?? []).map((g) => g.id)

  // 外部キー制約の順に削除
  if (gameIds.length > 0) {
    const { error: e1 } = await supabase.from('votes').delete().in('game_id', gameIds)
    if (e1) return NextResponse.json({ error: `votes削除失敗: ${e1.message}` }, { status: 500 })

    const { error: e2 } = await supabase.from('submissions').delete().in('game_id', gameIds)
    if (e2) return NextResponse.json({ error: `submissions削除失敗: ${e2.message}` }, { status: 500 })

    const { error: e3 } = await supabase.from('games').delete().in('tournament_id', tournamentIds)
    if (e3) return NextResponse.json({ error: `games削除失敗: ${e3.message}` }, { status: 500 })
  }

  const { error: e4 } = await supabase.from('player_hands').delete().in('tournament_id', tournamentIds)
  if (e4) return NextResponse.json({ error: `player_hands削除失敗: ${e4.message}` }, { status: 500 })

  const { error: e5 } = await supabase.from('cards').delete().in('tournament_id', tournamentIds)
  if (e5) return NextResponse.json({ error: `cards削除失敗: ${e5.message}` }, { status: 500 })

  const { error: e6 } = await supabase.from('tournament_participants').delete().in('tournament_id', tournamentIds)
  if (e6) return NextResponse.json({ error: `tournament_participants削除失敗: ${e6.message}` }, { status: 500 })

  const { error: e7 } = await supabase.from('tournaments').delete().in('id', tournamentIds)
  if (e7) return NextResponse.json({ error: `tournaments削除失敗: ${e7.message}` }, { status: 500 })

  return NextResponse.json({ success: true, deleted: tournamentIds.length })
}
