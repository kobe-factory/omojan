import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { user_id, texts, dirty_texts } = await request.json()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, status, cards_per_user')
    .eq('token', token)
    .single()

  if (!tournament || !['waiting_users', 'creating_cards'].includes(tournament.status)) {
    return NextResponse.json({ error: '札作成フェーズではありません' }, { status: 400 })
  }

  // 既存の札を削除して作り直し（修正対応）
  await supabase.from('cards').delete().eq('tournament_id', tournament.id).eq('creator_user_id', user_id)

  const regularRows = (texts ?? []).map((text: string) => ({
    tournament_id: tournament.id,
    creator_user_id: user_id,
    text,
    is_dirty: false,
  }))
  const dirtyRows = (dirty_texts ?? []).map((text: string) => ({
    tournament_id: tournament.id,
    creator_user_id: user_id,
    text,
    is_dirty: true,
  }))
  const cardRows = [...regularRows, ...dirtyRows]

  const { error } = await supabase.from('cards').insert(cardRows)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
