import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface CompactStats {
  gamesParticipated: number
  mvpCount: number
  mvpWinRate: number
  avgVotesPerGame: number
  homeRuns: number
  singles: number
  doubles: number
  triples: number
  shutoutCount: number
  shutoutRate: number
  preambleCount: number
  preambleUsageRate: number
  loneVoteCount: number
  cardUsageRate: number
}

interface UserCommentInput {
  userId: string
  userName: string
  overall: CompactStats
  last: CompactStats | null
  lastTournamentNumber: number | null
  cardTexts: string[]
}

// GET: 保存済みコメントを返す
export async function GET() {
  const { data } = await supabase.from('user_ai_comments').select('*')
  return NextResponse.json({ comments: data ?? [] })
}

// POST: 未生成 or 新大会追加時のみ生成（force=trueで強制再生成）
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === 'true'

  const { data: finishedTournaments } = await supabase
    .from('tournaments')
    .select('id, created_at')
    .eq('mode', 'production')
    .eq('status', 'finished')
    .order('created_at', { ascending: true })

  const tournamentCount = finishedTournaments?.length ?? 0
  if (tournamentCount === 0) {
    return NextResponse.json({ message: '終了済み大会なし', generated: false })
  }

  // 最新コメントが現在の大会数と一致していればスキップ（強制時は除く）
  if (!force) {
    const { data: existingAny } = await supabase
      .from('user_ai_comments')
      .select('tournament_count')
      .limit(1)
      .maybeSingle()

    if (existingAny && existingAny.tournament_count === tournamentCount) {
      return NextResponse.json({ message: '最新コメント済み', generated: false, upToDate: true })
    }
  }

  const { data: users } = await supabase.from('users').select('id, name')
  if (!users || users.length === 0) {
    return NextResponse.json({ error: 'ユーザーなし' }, { status: 500 })
  }

  const allTournamentIds = (finishedTournaments ?? []).map((t) => t.id)
  const lastTournamentId = allTournamentIds[allTournamentIds.length - 1]
  const lastTournamentNumber = tournamentCount

  // 大会ごとの有効ゲームID（流局除外）
  const validGameIds = await computeValidGameIds(allTournamentIds)
  const lastTournamentValidGameIds = await computeValidGameIds([lastTournamentId])

  // 集計データ取得
  const { data: allCards } = await supabase
    .from('cards')
    .select('id, creator_user_id, tournament_id, text')
    .in('tournament_id', allTournamentIds)

  const gameIdsAll = [...validGameIds]
  const gameIdsLast = [...lastTournamentValidGameIds]
  const allGameIds = [...new Set([...gameIdsAll, ...gameIdsLast])]

  if (allGameIds.length === 0) {
    return NextResponse.json({ error: 'ゲームデータなし' }, { status: 500 })
  }

  const [
    { data: allSubs },
    { data: allVotes },
    { data: allMashResults },
  ] = await Promise.all([
    supabase.from('submissions').select('id, user_id, hand_card_id, game_id, preamble').in('game_id', allGameIds),
    supabase.from('votes').select('voter_user_id, submission_id, game_id, is_tiebreaker').in('game_id', allGameIds),
    supabase.from('button_mash_results').select('game_id, user_id, tap_count, mash_round').in('game_id', allGameIds),
  ])

  const submissions = allSubs ?? []
  const votes = allVotes ?? []
  const mashResults = allMashResults ?? []
  const cards = allCards ?? []

  const userInputs: UserCommentInput[] = users.map((user) => {
    const overall = computeStats(user.id, cards, submissions, votes, mashResults, validGameIds)
    const last = gameIdsLast.length > 0
      ? computeStats(user.id, cards, submissions, votes, mashResults, lastTournamentValidGameIds)
      : null
    const cardTexts = cards
      .filter((c) => c.creator_user_id === user.id)
      .map((c) => c.text)

    return {
      userId: user.id,
      userName: user.name,
      overall,
      last,
      lastTournamentNumber,
      cardTexts,
    }
  })

  // Claude で一括生成
  const generated = await generateAllComments(userInputs)
  if (!generated) {
    return NextResponse.json({ error: 'Claude API エラー' }, { status: 500 })
  }

  // DB 保存（upsert）
  for (const item of generated) {
    await supabaseAdmin.from('user_ai_comments').upsert(
      {
        user_id: item.userId,
        overall_comment: item.overallComment,
        last_tournament_comment: item.lastComment,
        card_analysis_comment: item.cardAnalysisComment,
        nickname: item.nickname,
        last_tournament_id: lastTournamentId,
        tournament_count: tournamentCount,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  }

  return NextResponse.json({ success: true, generated: generated.length })
}

// ---- helpers ----

async function computeValidGameIds(tournamentIds: string[]): Promise<Set<string>> {
  if (tournamentIds.length === 0) return new Set()

  const { data: games } = await supabase
    .from('games')
    .select('id, tournament_id, round_number, is_rematch')
    .in('tournament_id', tournamentIds)
    .gt('round_number', 0)

  const result = new Set<string>()
  for (const tId of tournamentIds) {
    const tGames = (games ?? []).filter((g) => g.tournament_id === tId)
    const rematchRounds = new Set(tGames.filter((g) => g.is_rematch).map((g) => g.round_number))
    for (const g of tGames) {
      if (!(g.is_rematch === false && rematchRounds.has(g.round_number))) {
        result.add(g.id)
      }
    }
  }
  return result
}

function computeStats(
  userId: string,
  cards: { id: string; creator_user_id: string; tournament_id: string; text: string }[],
  submissions: { id: string; user_id: string; hand_card_id: string; game_id: string; preamble: string | null }[],
  votes: { voter_user_id: string; submission_id: string; game_id: string; is_tiebreaker: boolean }[],
  mashResults: { game_id: string; user_id: string; tap_count: number; mash_round: number }[],
  validGameIds: Set<string>,
): CompactStats {
  const initialVotes = votes.filter((v) => !v.is_tiebreaker)

  // 作品別得票数
  const voteCountBySub: Record<string, number> = {}
  for (const v of initialVotes) {
    if (validGameIds.has(v.game_id)) {
      voteCountBySub[v.submission_id] = (voteCountBySub[v.submission_id] ?? 0) + 1
    }
  }

  const gamesWithVotes = new Set(initialVotes.filter((v) => validGameIds.has(v.game_id)).map((v) => v.game_id))

  // ゲーム別勝者
  const subsByGame: Record<string, { id: string; userId: string }[]> = {}
  for (const s of submissions) {
    if (!validGameIds.has(s.game_id)) continue
    if (!subsByGame[s.game_id]) subsByGame[s.game_id] = []
    subsByGame[s.game_id].push({ id: s.id, userId: s.user_id })
  }

  const winnersByGame: Record<string, string[]> = {}
  for (const [gameId, subs] of Object.entries(subsByGame)) {
    const gameMash = mashResults.filter((r) => r.game_id === gameId)
    if (gameMash.length >= 2) {
      const maxRound = Math.max(...gameMash.map((r) => r.mash_round))
      const latest = gameMash.filter((r) => r.mash_round === maxRound)
      const maxTaps = Math.max(...latest.map((r) => r.tap_count))
      const winner = latest.find((r) => r.tap_count === maxTaps)
      if (winner) {
        const ws = subs.find((s) => s.userId === winner.user_id)
        if (ws) winnersByGame[gameId] = [ws.id]
      }
      continue
    }
    const tbVotes = votes.filter((v) => v.game_id === gameId && v.is_tiebreaker)
    if (tbVotes.length > 0) {
      const tbCount: Record<string, number> = {}
      for (const v of tbVotes) tbCount[v.submission_id] = (tbCount[v.submission_id] ?? 0) + 1
      const maxTb = Math.max(...Object.values(tbCount))
      const w = Object.entries(tbCount).find(([, c]) => c === maxTb)
      if (w) winnersByGame[gameId] = [w[0]]
      continue
    }
    let maxV = 0
    for (const s of subs) {
      const c = voteCountBySub[s.id] ?? 0
      if (c > maxV) maxV = c
    }
    if (maxV > 0) {
      winnersByGame[gameId] = subs.filter((s) => (voteCountBySub[s.id] ?? 0) === maxV).map((s) => s.id)
    }
  }

  const myCardIds = new Set(cards.filter((c) => c.creator_user_id === userId).map((c) => c.id))
  const myCards = cards.filter((c) => c.creator_user_id === userId)
  const cardsCreated = myCards.length
  const cardsUsed = submissions.filter((s) => myCardIds.has(s.hand_card_id)).length
  const cardUsageRate = cardsCreated > 0 ? cardsUsed / cardsCreated : 0

  const mySubs = submissions.filter((s) => s.user_id === userId && validGameIds.has(s.game_id))
  const gamesParticipated = mySubs.length
  const totalVotesReceived = mySubs.reduce((sum, s) => sum + (voteCountBySub[s.id] ?? 0), 0)
  const avgVotesPerGame = gamesParticipated > 0 ? totalVotesReceived / gamesParticipated : 0

  let singles = 0, doubles = 0, triples = 0, homeRuns = 0
  for (const s of mySubs) {
    const c = voteCountBySub[s.id] ?? 0
    if (c === 1) singles++
    else if (c === 2) doubles++
    else if (c === 3) triples++
    else if (c >= 4) homeRuns++
  }

  const mvpCount = mySubs.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).length
  const mvpWinRate = gamesParticipated > 0 ? mvpCount / gamesParticipated : 0

  const shutoutCount = mySubs.filter(
    (s) => gamesWithVotes.has(s.game_id) && (voteCountBySub[s.id] ?? 0) === 0
  ).length
  const shutoutRate = gamesParticipated > 0 ? shutoutCount / gamesParticipated : 0

  const preambledSubs = mySubs.filter((s) => s.preamble && (s.preamble as string).trim().length > 0)
  const preambleCount = preambledSubs.length
  const preambleUsageRate = gamesParticipated > 0 ? preambleCount / gamesParticipated : 0

  const myWinGameIds = new Set(mySubs.filter((s) => (winnersByGame[s.game_id] ?? []).includes(s.id)).map((s) => s.game_id))
  const myVotesCast = initialVotes.filter((v) => v.voter_user_id === userId && validGameIds.has(v.game_id))
  const fairVotesCast = myVotesCast.filter((v) => !myWinGameIds.has(v.game_id))
  const loneVoteCount = myVotesCast.filter(
    (v) => (voteCountBySub[v.submission_id] ?? 0) === 1 && !(winnersByGame[v.game_id] ?? []).includes(v.submission_id)
  ).length

  void fairVotesCast

  return {
    gamesParticipated,
    mvpCount,
    mvpWinRate,
    avgVotesPerGame,
    homeRuns,
    singles,
    doubles,
    triples,
    shutoutCount,
    shutoutRate,
    preambleCount,
    preambleUsageRate,
    loneVoteCount,
    cardUsageRate,
  }
}

function formatStats(s: CompactStats): string {
  const fmt = (n: number) => n.toFixed(3).replace(/^0/, '')
  return [
    `出場${s.gamesParticipated}回`,
    `MVP${s.mvpCount}回(勝率${fmt(s.mvpWinRate)})`,
    `平均得票${s.avgVotesPerGame.toFixed(2)}`,
    `1B${s.singles}/2B${s.doubles}/3B${s.triples}/HR${s.homeRuns}`,
    `完封${s.shutoutCount}回(${fmt(s.shutoutRate)})`,
    `前口上${s.preambleCount}回(使用率${fmt(s.preambleUsageRate)})`,
    `孤独投票${s.loneVoteCount}回`,
    `作成札採用率${fmt(s.cardUsageRate)}`,
  ].join(' | ')
}

async function generateAllComments(
  users: UserCommentInput[],
): Promise<{ userId: string; overallComment: string; lastComment: string; cardAnalysisComment: string; nickname: string }[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY が設定されていません')
    return null
  }

  const playerSection = users
    .map((u) => {
      const overallLine = `【${u.userName}】通算: ${formatStats(u.overall)}`
      const lastLine = u.last && u.lastTournamentNumber
        ? `【${u.userName}】第${u.lastTournamentNumber}回大会: ${formatStats(u.last)}`
        : `【${u.userName}】前回大会: データなし`
      const cardLine = u.cardTexts.length > 0
        ? `【${u.userName}】作成した札（全${u.cardTexts.length}枚）: 「${u.cardTexts.join('」「')}」`
        : `【${u.userName}】作成した札: なし`
      return `${overallLine}\n${lastLine}\n${cardLine}`
    })
    .join('\n\n')

  const prompt = `あなたは「おもじゃん」というワードバトルゲームの毒舌実況解説者です。
以下のプレイヤーの成績データと作成した札の一覧を見て、それぞれ4種類のコメントを書いてください。

ルール：
- 各コメントは300文字（厳守）。300文字をフルに使って書くこと。短くなるのは禁止
- 面白く、辛辣に、友人への毒舌トークで書く
- 具体的な数字や単語に触れつつ、ポジネガ両面を突っ込む
- 日本語のみ（絵文字可）
- card_analysis_commentは作成した札の内容・傾向・テーマ（下ネタ率・食べ物ネタ・哲学系・語感重視など）を深掘りして辛辣にコメント
- nicknameは成績と札の傾向を総合したユニークな称号。バラエティ豊かに（例：「下ネタ製造機の異名を持つ男」「孤高の天才・誰にも理解されない芸術家」「連打だけは強い筋肉バカ」「毎回完封される不屈の魂」など）。20文字以内
- JSONのみ返す（説明不要）

成績データ・作成した札：
${playerSection}

以下のJSON形式で返してください：
{
  "users": [
    {
      "user_id": "ここにuuid",
      "overall_comment": "...",
      "last_comment": "...",
      "card_analysis_comment": "...",
      "nickname": "..."
    }
  ]
}

user_idはそれぞれ: ${users.map((u) => `${u.userName}=${u.userId}`).join(', ')}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('Claude API エラー:', await res.text())
      return null
    }

    const json = await res.json()
    const text: string = json.content?.[0]?.text ?? ''

    // JSON部分を抽出
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error('JSONパース失敗:', text)
      return null
    }

    const parsed = JSON.parse(match[0]) as {
      users: { user_id: string; overall_comment: string; last_comment: string; card_analysis_comment: string; nickname: string }[]
    }

    return parsed.users.map((u) => ({
      userId: u.user_id,
      overallComment: u.overall_comment ?? '',
      lastComment: u.last_comment ?? '',
      cardAnalysisComment: u.card_analysis_comment ?? '',
      nickname: u.nickname ?? '',
    }))
  } catch (e) {
    console.error('generateAllComments エラー:', e)
    return null
  }
}
