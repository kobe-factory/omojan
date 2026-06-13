import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendLinePush } from '@/lib/line-push'
import { nanoid } from 'nanoid'

const LIFF_URL = `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`

const EXHIBITION_AI_CHARS = ['こんべ(AI)', 'スラパン(AI)', 'はじむ(AI)', 'カズさん(AI)', 'かっぴー(AI)']

export async function POST(request: Request) {
  const { mode, required_players, game_count, cards_per_user, hand_cards_per_player, dirty_cards_per_user, card_source, voting_style, tiebreaker_mode, ai_cards_mode, ai_player_character, tournament_type } = await request.json()

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

  const isExhibition = tournament_type === 'exhibition'
  const isAiCardsMode = !isExhibition && mode === 'production' && ai_cards_mode === true
  const skipCardCreation = isExhibition || isAiCardsMode || (mode === 'production' && (card_source === 'previous' || card_source === 'all' || card_source === 'unused_submission' || card_source === 'unused_complete'))
  const hasAiPlayer = !isExhibition && mode === 'production' && !!ai_player_character
  const token = nanoid(10)
  // AIプレイヤーが参加する場合はrequired_playersを+1（AI分を含むため）
  // エキシビションは常に5名のAIキャラが参加
  const effectiveRequiredPlayers = isExhibition ? EXHIBITION_AI_CHARS.length : hasAiPlayer ? (required_players ?? 5) + 1 : (required_players ?? 5)

  const resolvedGameCount = game_count ?? 5
  const isSecretOne = voting_style === 'secret_one'
  const isSecretAll = voting_style === 'secret_all'
  const secretVoting = isSecretOne || isSecretAll
  // secret_one: ランダムな1回戦のみシークレット / secret_all: 全回戦シークレット(null=全回戦)
  const secretRound = isSecretOne ? Math.floor(Math.random() * resolvedGameCount) + 1 : null
  const impersonationMode = voting_style === 'impersonation'
  const randomVoting = voting_style === 'random_per_round'

  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      token,
      mode: mode ?? 'production',
      required_players: effectiveRequiredPlayers,
      game_count: resolvedGameCount,
      cards_per_user: cards_per_user ?? 0,
      hand_cards_per_player,
      dirty_cards_per_user: dirty_cards_per_user ?? 0,
      skip_card_creation: skipCardCreation,
      secret_voting: secretVoting,
      secret_round: secretRound,
      impersonation_mode: impersonationMode,
      random_voting: randomVoting,
      tiebreaker_mode: tiebreaker_mode ?? 'vote',
      ai_cards_mode: isAiCardsMode,
      ai_player_character: hasAiPlayer ? ai_player_character : null,
      tournament_type: isExhibition ? 'exhibition' : 'normal',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // AIプレイヤー：大会発行時に自動参加 + カード生成
  if (hasAiPlayer) {
    const { data: aiUser } = await supabase
      .from('users')
      .select('id')
      .eq('name', ai_player_character)
      .maybeSingle()

    if (!aiUser) {
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: `AIキャラクター「${ai_player_character}」がDBに存在しません。SQLを実行してユーザーを登録してください。` }, { status: 400 })
    }

    // 自動参加
    await supabase.from('tournament_participants').insert({
      tournament_id: data.id,
      user_id: aiUser.id,
    })

    // AI札作成モードでない場合はAIプレイヤー分のカードを生成
    if (!isAiCardsMode) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
      const aiCardRes = await fetch(`${baseUrl}/api/ai/player/generate-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_id: data.id,
          user_id: aiUser.id,
          character_name: ai_player_character,
          cards_per_user: cards_per_user ?? 12,
          dirty_cards_per_user: dirty_cards_per_user ?? 2,
        }),
      })
      if (!aiCardRes.ok) {
        const cardErr = await aiCardRes.json()
        await supabase.from('tournaments').delete().eq('id', data.id)
        return NextResponse.json({ error: cardErr.error ?? 'AIプレイヤーのカード生成に失敗しました' }, { status: 500 })
      }
    }
  }

  // エキシビション：5名のAIキャラを全員自動参加 + カード生成
  if (isExhibition) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

    // 5名のAIユーザーを取得
    const { data: aiUsers } = await supabase
      .from('users')
      .select('id, name')
      .in('name', EXHIBITION_AI_CHARS)

    if (!aiUsers || aiUsers.length !== EXHIBITION_AI_CHARS.length) {
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: `エキシビション用AIキャラクターがDBに存在しません。${EXHIBITION_AI_CHARS.join(', ')} を登録してください。` }, { status: 400 })
    }

    // 全員を参加者として登録
    const participantRows = aiUsers.map((u) => ({ tournament_id: data.id, user_id: u.id }))
    const { error: partErr } = await supabase.from('tournament_participants').insert(participantRows)
    if (partErr) {
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: partErr.message }, { status: 500 })
    }

    // 各AIキャラのカードを生成（並列）
    const cardGenResults = await Promise.all(
      aiUsers.map((u) =>
        fetch(`${baseUrl}/api/ai/player/generate-cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournament_id: data.id,
            user_id: u.id,
            character_name: u.name,
            cards_per_user: cards_per_user ?? 12,
            dirty_cards_per_user: dirty_cards_per_user ?? 2,
          }),
        })
      )
    )

    const failedCard = cardGenResults.find((r) => !r.ok)
    if (failedCard) {
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: 'エキシビションのAIカード生成に失敗しました' }, { status: 500 })
    }

    // 大会URLをLINE通知
    if (mode === 'production') {
      const { data: users } = await supabase.from('users').select('line_user_id').not('line_user_id', 'is', null)
      const lineUserIds = (users ?? []).map((u) => u.line_user_id).filter(Boolean) as string[]
      if (lineUserIds.length > 0) {
        const { data: allTournaments } = await supabase.from('tournaments').select('id, created_at').eq('mode', 'production').order('created_at', { ascending: true })
        const idx = (allTournaments ?? []).findIndex((t) => t.id === data.id)
        const num = idx >= 0 ? idx + 1 : 1
        await sendLinePush(lineUserIds, {
          headerTitle: '🤖 エキシビション開催！',
          headerColor: '#7c3aed',
          headerSub: `第${num}回大会（エキシビション）`,
          body: 'AIキャラクター同士のエキシビションが始まりました！\nおもじゃんを開いて観戦しましょう 👀',
          url: LIFF_URL,
        })
      }
    }

    return NextResponse.json({ token: data.token })
  }

  // AI札作成モード：AIでカード生成
  if (isAiCardsMode) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
    const genRes = await fetch(`${baseUrl}/api/ai/generate-cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament_id: data.id,
        cards_per_user: cards_per_user ?? 12,
        dirty_cards_per_user: dirty_cards_per_user ?? 2,
      }),
    })
    if (!genRes.ok) {
      const genError = await genRes.json()
      await supabase.from('tournaments').delete().eq('id', data.id)
      return NextResponse.json({ error: genError.error ?? 'AI札生成に失敗しました' }, { status: 500 })
    }
  } else if (skipCardCreation) {
    // 前回 or 全大会の札をコピー
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

async function copyCards(newTournamentId: string, source: 'previous' | 'all' | 'unused_submission' | 'unused_complete'): Promise<string | null> {
  // 未使用札コピー
  if (source === 'unused_submission' || source === 'unused_complete') {
    const { data: sourceTournaments } = await supabase
      .from('tournaments')
      .select('id')
      .eq('mode', 'production')
      .eq('status', 'finished')

    if (!sourceTournaments || sourceTournaments.length === 0) {
      return '参照できる過去の本番大会がありません'
    }

    const sourceIds = sourceTournaments.map((t) => t.id)

    const { data: allCards } = await supabase
      .from('cards')
      .select('id, creator_user_id, text, is_dirty')
      .in('tournament_id', sourceIds)

    if (!allCards || allCards.length === 0) {
      return '参照元の大会に札がありません'
    }

    // お題として使用済みのカードIDを取得
    const { data: games } = await supabase
      .from('games')
      .select('id, topic_card_id')
      .in('tournament_id', sourceIds)
    const usedTopicIds = new Set((games ?? []).map((g) => g.topic_card_id))
    const gameIds = (games ?? []).map((g) => g.id)

    let unusedCards: typeof allCards

    if (source === 'unused_submission') {
      // 手札として作品に使われたカードIDを取得
      const usedHandIds = new Set<string>()
      if (gameIds.length > 0) {
        const { data: usedSubs } = await supabase
          .from('submissions')
          .select('hand_card_id')
          .in('game_id', gameIds)
        for (const s of usedSubs ?? []) usedHandIds.add(s.hand_card_id)
      }
      unusedCards = allCards.filter((c) => !usedHandIds.has(c.id) && !usedTopicIds.has(c.id))
    } else {
      // 配布済みのカードIDを取得
      const { data: dealtHands } = await supabase
        .from('player_hands')
        .select('card_id')
        .in('tournament_id', sourceIds)
      const dealtCardIds = new Set((dealtHands ?? []).map((h) => h.card_id))
      unusedCards = allCards.filter((c) => !dealtCardIds.has(c.id) && !usedTopicIds.has(c.id))
    }

    if (unusedCards.length === 0) {
      return '未使用の札がありません'
    }

    const cardRows = unusedCards.map((c) => ({
      tournament_id: newTournamentId,
      creator_user_id: c.creator_user_id,
      text: c.text,
      is_dirty: c.is_dirty,
    }))

    const { error } = await supabase.from('cards').insert(cardRows)
    if (error) return error.message
    return null
  }

  // 前回 or 全大会の札をコピー
  const baseQuery = supabase
    .from('tournaments')
    .select('id')
    .eq('mode', 'production')
    .eq('status', 'finished')
    .order('created_at', { ascending: false })

  const { data: sourceTournaments } = source === 'previous'
    ? await baseQuery.limit(1)
    : await baseQuery

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
