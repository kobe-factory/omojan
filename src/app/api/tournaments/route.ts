import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'
import { nanoid } from 'nanoid'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

export async function POST(request: Request) {
  const { mode, required_players, game_count, cards_per_user, hand_cards_per_player, dirty_cards_per_user, card_source, secret_voting } = await request.json()

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

  const skipCardCreation = mode === 'production' && (card_source === 'previous' || card_source === 'all')
  const token = nanoid(10)

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      token,
      mode: mode ?? 'production',
      required_players,
      game_count,
      cards_per_user: cards_per_user ?? 0,
      hand_cards_per_player,
      dirty_cards_per_user: dirty_cards_per_user ?? 0,
      skip_card_creation: skipCardCreation,
      secret_voting: secret_voting ?? false,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 前回 or 全大会の札をコピー
  if (skipCardCreation) {
    const sourceError = await copyCards(data.id, card_source)
    if (sourceError) {
      // ロールバック：作成した大会を削除
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: sourceError }, { status: 500 })
    }
  }

  // 本番大会発行時：LINE登録済みユーザー全員に通知
  if (mode === 'production') {
    const { data: users } = await supabase
      .from('users')
      .select('line_user_id')
      .not('line_user_id', 'is', null)

    const lineUserIds = (users ?? []).map((u) => u.line_user_id).filter(Boolean) as string[]
    if (lineUserIds.length > 0) {
      const { data: allTournaments } = await supabase
        .from('tournaments')
        .select('id, created_at')
        .eq('mode', 'production')
        .order('created_at', { ascending: true })
      const idx = (allTournaments ?? []).findIndex((t) => t.id === data.id)
      const num = idx >= 0 ? idx + 1 : 1

      await sendLinePush(lineUserIds, {
        headerTitle: '🎯 新大会スタート！',
        headerColor: '#0284c7',
        headerSub: `第${num}回大会`,
        body: '新しい大会が始まりました！\nおもじゃんを開いてユーザー登録してください 👥',
        url: LIFF_URL,
      })
    }
  }

  return NextResponse.json({ token: data.token })
}

async function copyCards(newTournamentId: string, source: 'previous' | 'all'): Promise<string | null> {
  // コピー元の本番大会を取得
  const query = supabase
    .from('tournaments')
    .select('id')
    .eq('mode', 'production')
    .eq('status', 'finished')
    .order('created_at', { ascending: false })

  if (source === 'previous') {
    query.limit(1)
  }

  const { data: sourceTournaments } = await query

  if (!sourceTournaments || sourceTournaments.length === 0) {
    return '参照できる過去の本番大会がありません'
  }

  const sourceIds = sourceTournaments.map((t) => t.id)

  const { data: sourceCards } = await supabase
    .from('cards')
    .select('creator_user_id, text, is_dirty')
    .in('tournament_id', sourceIds)

  if (!sourceCards || sourceCards.length === 0) {
    return '参照元の大会に札がありません'
  }

  const cardRows = sourceCards.map((c) => ({
    tournament_id: newTournamentId,
    creator_user_id: c.creator_user_id,
    text: c.text,
    is_dirty: c.is_dirty,
  }))

  const { error } = await supabase.from('cards').insert(cardRows)
  if (error) return error.message

  return null
}
