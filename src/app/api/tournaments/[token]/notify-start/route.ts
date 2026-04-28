import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

async function getTournamentNumber(tournamentId: string): Promise<number> {
  const { data } = await supabase
    .from('tournaments')
    .select('id, created_at')
    .eq('mode', 'production')
    .order('created_at', { ascending: true })

  const idx = (data ?? []).findIndex((t) => t.id === tournamentId)
  return idx >= 0 ? idx + 1 : 1
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, mode')
    .eq('token', token)
    .single()

  if (!tournament) {
    return NextResponse.json({ error: '大会が見つかりません' }, { status: 404 })
  }

  if (tournament.mode !== 'production') {
    return NextResponse.json({ error: '本番大会のみ通知できます' }, { status: 400 })
  }

  // 参加済みユーザーのIDを取得
  const { data: participants } = await supabase
    .from('tournament_participants')
    .select('user_id')
    .eq('tournament_id', tournament.id)

  const joinedUserIds = new Set((participants ?? []).map((p) => p.user_id))

  // 未参加かつLINE ID登録済みのユーザーのみ対象
  const { data: users } = await supabase
    .from('users')
    .select('id, line_user_id')
    .not('line_user_id', 'is', null)

  const lineUserIds = (users ?? [])
    .filter((u) => !joinedUserIds.has(u.id))
    .map((u) => u.line_user_id)
    .filter(Boolean) as string[]

  if (lineUserIds.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const num = await getTournamentNumber(tournament.id)
  await sendLinePush(lineUserIds, {
    headerTitle: '🎯 新大会開始',
    headerColor: '#0284c7',
    headerSub: `第${num}回大会`,
    body: '新しい大会が始まりました！\nおもじゃんを開いてユーザー登録してください 👥',
    url: LIFF_URL,
  })

  return NextResponse.json({ sent: lineUserIds.length })
}
