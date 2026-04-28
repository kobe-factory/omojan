import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'
import { nanoid } from 'nanoid'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

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
