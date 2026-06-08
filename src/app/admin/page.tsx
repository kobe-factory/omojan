'use client'

import { useState, useEffect, useCallback } from 'react'
import { GAME_PRESETS, DEFAULT_PRESET, type GamePreset } from '@/config/game'
import { supabase } from '@/lib/supabase'

interface GameRow {
  round_number: number
  is_rematch: boolean
  status: string
  voting_mode: string | null
}

interface TournamentRow {
  id: string
  token: string
  mode: string
  status: string
  created_at: string
  game_count: number
  cards_per_user: number
  hand_cards_per_player: number
  dirty_cards_per_user: number
  secret_voting: boolean
  secret_round: number | null
  impersonation_mode: boolean
  random_voting: boolean
  productionNumber?: number
  currentGame?: { round_number: number; status: string }
  allGames?: GameRow[]
}

const STATUS_LABEL: Record<string, string> = {
  waiting_users: 'ユーザー選択中',
  creating_cards: '札作成中',
  playing: 'ゲーム中',
  finished: '終了',
}

const GAME_STATUS_LABEL: Record<string, string> = {
  waiting_submission: '作品投稿中',
  waiting_vote: '投票中',
  waiting_tiebreaker_vote: '決選投票中',
  showing_result: '結果発表中',
  showing_rematch: '再戦準備中',
  finished: '終了',
}

const MODE_LABEL: Record<string, string> = {
  solo: 'ソロ',
  test: '2名テスト',
  production: '本番',
}


export default function AdminPage() {
  const [selectedPreset, setSelectedPreset] = useState<GamePreset>(DEFAULT_PRESET)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [activeProductionTournament, setActiveProductionTournament] = useState<TournamentRow | null>(null)
  const [notifying, setNotifying] = useState(false)
  const [notified, setNotified] = useState(false)
  const [generatingComments, setGeneratingComments] = useState(false)
  const [commentGenResult, setCommentGenResult] = useState<string | null>(null)
  const [forceRegenTapCount, setForceRegenTapCount] = useState(0)
  const [showForceRegen, setShowForceRegen] = useState(false)

  const productionPreset = GAME_PRESETS.find((p) => p.mode === 'production')!
  const [prodGameCount, setProdGameCount] = useState(String(productionPreset.game_count))
  const [prodCardsPerUser, setProdCardsPerUser] = useState(String(productionPreset.cards_per_user))
  const [prodHandCards, setProdHandCards] = useState(String(productionPreset.hand_cards_per_player))
  const [prodDirtyCards, setProdDirtyCards] = useState(String(productionPreset.dirty_cards_per_user))
  const [cardSource, setCardSource] = useState<'new' | 'previous' | 'all' | 'unused_submission' | 'unused_complete'>('new')
  const [unusedCardInfo, setUnusedCardInfo] = useState<{ available: number; required: number } | null>(null)
  const [checkingCards, setCheckingCards] = useState(false)
  const [hasPastTournaments, setHasPastTournaments] = useState(false)
  const [votingStyle, setVotingStyle] = useState<'normal' | 'secret_one' | 'secret_all' | 'impersonation' | 'random_per_round'>('normal')
  const [tiebreakerMode, setTiebreakerMode] = useState<'vote' | 'button_mash'>('vote')

  const fetchTournaments = useCallback(async () => {
    setListLoading(true)
    const { data } = await supabase
      .from('tournaments')
      .select('id, token, mode, status, created_at, game_count, cards_per_user, hand_cards_per_player, dirty_cards_per_user, secret_voting, secret_round, impersonation_mode, random_voting')
      .order('created_at', { ascending: false })

    // 本番大会に作成日時昇順で連番を付与
    const rows = data ?? []
    const productionSorted = rows
      .filter((t) => t.mode === 'production')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const productionNumberMap: Record<string, number> = {}
    productionSorted.forEach((t, i) => {
      productionNumberMap[t.id] = i + 1
    })

    // 全大会のゲームを一括取得（voting_mode確認のため）
    const allIds = rows.map((t) => t.id)
    const gameMap: Record<string, { round_number: number; status: string }> = {}
    const allGamesMap: Record<string, GameRow[]> = {}
    if (allIds.length > 0) {
      const { data: games } = await supabase
        .from('games')
        .select('tournament_id, round_number, is_rematch, status, voting_mode')
        .in('tournament_id', allIds)
        .order('round_number', { ascending: true })
        .order('created_at', { ascending: true })
      for (const g of games ?? []) {
        // 最新ゲーム（currentGame用）は別途抽出
        const cur = gameMap[g.tournament_id]
        if (!cur || g.round_number > cur.round_number) {
          gameMap[g.tournament_id] = { round_number: g.round_number, status: g.status }
        }
        // 全ゲームリスト
        if (!allGamesMap[g.tournament_id]) allGamesMap[g.tournament_id] = []
        allGamesMap[g.tournament_id].push({
          round_number: g.round_number,
          is_rematch: g.is_rematch,
          status: g.status,
          voting_mode: g.voting_mode,
        })
      }
    }

    const mapped = rows.map((t) => ({
      ...t,
      productionNumber: productionNumberMap[t.id],
      currentGame: gameMap[t.id],
      allGames: allGamesMap[t.id] ?? [],
    }))
    setTournaments(mapped)

    const active = mapped.find(
      (t) => t.mode === 'production' && ['waiting_users', 'creating_cards', 'playing'].includes(t.status)
    ) ?? null
    setActiveProductionTournament(active)

    const hasPast = mapped.some((t) => t.mode === 'production' && t.status === 'finished')
    setHasPastTournaments(hasPast)

    setListLoading(false)
  }, [])

  useEffect(() => {
    fetchTournaments()
  }, [fetchTournaments])

  useEffect(() => {
    if (cardSource !== 'unused_submission' && cardSource !== 'unused_complete') {
      setUnusedCardInfo(null)
      return
    }
    let cancelled = false
    async function checkUnused() {
      setCheckingCards(true)
      try {
        const { data: sourceTournaments } = await supabase
          .from('tournaments')
          .select('id')
          .eq('mode', 'production')
          .eq('status', 'finished')

        const handCards = parseInt(prodHandCards) || productionPreset.hand_cards_per_player
        const gameCount = parseInt(prodGameCount) || productionPreset.game_count
        const required = handCards * productionPreset.required_players + gameCount

        if (!sourceTournaments || sourceTournaments.length === 0) {
          if (!cancelled) setUnusedCardInfo({ available: 0, required })
          return
        }
        const sourceIds = sourceTournaments.map((t) => t.id)

        const { data: allCards } = await supabase
          .from('cards')
          .select('id')
          .in('tournament_id', sourceIds)

        if (!allCards || allCards.length === 0) {
          if (!cancelled) setUnusedCardInfo({ available: 0, required })
          return
        }

        const { data: games } = await supabase
          .from('games')
          .select('id, topic_card_id')
          .in('tournament_id', sourceIds)
        const usedTopicIds = new Set((games ?? []).map((g) => g.topic_card_id))
        const gameIds = (games ?? []).map((g) => g.id)

        let available = 0
        if (cardSource === 'unused_submission') {
          const usedHandIds = new Set<string>()
          if (gameIds.length > 0) {
            const { data: subs } = await supabase
              .from('submissions')
              .select('hand_card_id')
              .in('game_id', gameIds)
            for (const s of subs ?? []) usedHandIds.add(s.hand_card_id)
          }
          available = allCards.filter((c) => !usedHandIds.has(c.id) && !usedTopicIds.has(c.id)).length
        } else {
          const { data: dealt } = await supabase
            .from('player_hands')
            .select('card_id')
            .in('tournament_id', sourceIds)
          const dealtIds = new Set((dealt ?? []).map((h) => h.card_id))
          available = allCards.filter((c) => !dealtIds.has(c.id) && !usedTopicIds.has(c.id)).length
        }

        if (!cancelled) setUnusedCardInfo({ available, required })
      } finally {
        if (!cancelled) setCheckingCards(false)
      }
    }
    checkUnused()
    return () => { cancelled = true }
  }, [cardSource, prodHandCards, prodGameCount, productionPreset])

  async function handleCreate() {
    setLoading(true)
    setGeneratedUrl(null)
    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: selectedPreset.mode,
          required_players: selectedPreset.required_players,
          game_count: selectedPreset.mode === 'production' ? (parseInt(prodGameCount) || productionPreset.game_count) : selectedPreset.game_count,
          cards_per_user: selectedPreset.mode === 'production' ? (parseInt(prodCardsPerUser) || productionPreset.cards_per_user) : selectedPreset.cards_per_user,
          hand_cards_per_player: selectedPreset.mode === 'production' ? (parseInt(prodHandCards) || productionPreset.hand_cards_per_player) : selectedPreset.hand_cards_per_player,
          dirty_cards_per_user: selectedPreset.mode === 'production' ? (parseInt(prodDirtyCards) || 0) : selectedPreset.dirty_cards_per_user,
          card_source: selectedPreset.mode === 'production' ? cardSource : 'new',
          voting_style: votingStyle,
          tiebreaker_mode: tiebreakerMode,
        }),
      })
      const data = await res.json()
      if (data.token) {
        setGeneratedUrl(`${window.location.origin}/${data.token}`)
        await fetchTournaments()
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!generatedUrl) return
    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function copyTournamentUrl(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/${token}`)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  async function handleNotifyStart() {
    if (!activeProductionTournament) return
    setNotifying(true)
    setNotified(false)
    try {
      await fetch(`/api/tournaments/${activeProductionTournament.token}/notify-start`, { method: 'POST' })
      setNotified(true)
      setTimeout(() => setNotified(false), 3000)
    } finally {
      setNotifying(false)
    }
  }

  async function handleReset() {
    const confirmed = window.confirm('ソロテスト・2名テストのデータを削除します。\n本番データは削除されません。\n\n本当にリセットしますか？')
    if (!confirmed) return

    setResetting(true)
    setResetDone(false)
    try {
      const res = await fetch('/api/admin/reset', { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setGeneratedUrl(null)
        await fetchTournaments()
        setResetDone(true)
        setTimeout(() => setResetDone(false), 3000)
      } else {
        alert(`リセット失敗: ${data.error}`)
      }
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">管理者画面</h1>
        <p className="text-sm text-gray-500 mb-6">大会URLを発行します</p>

        {/* 全大会サマリ */}
        <div className="mb-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-3">全大会サマリ</p>
          <div className="flex gap-2">
            <a
              href="/summary"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2 text-center text-sm font-medium text-emerald-600 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              サマリを開く
            </a>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}/summary`)
                setCopiedSummary(true)
                setTimeout(() => setCopiedSummary(false), 2000)
              }}
              className="flex-1 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors"
            >
              {copiedSummary ? 'コピー済み！' : 'URLをコピー'}
            </button>
          </div>
        </div>

        <p className="text-sm font-medium text-gray-700 mb-3">モードを選択</p>
        <div className="space-y-3 mb-8">
          {GAME_PRESETS.map((preset) => {
            const isSelected = selectedPreset.label === preset.label
            const isProductionBlocked = preset.mode === 'production' && !!activeProductionTournament
            return (
              <button
                key={preset.label}
                disabled={isProductionBlocked}
                onClick={() => {
                  if (isProductionBlocked) return
                  setSelectedPreset(preset)
                  setGeneratedUrl(null)
                }}
                className={`w-full text-left rounded-xl p-4 border-2 transition-all ${
                  isProductionBlocked
                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                    : isSelected
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 bg-white hover:border-emerald-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-bold text-base ${isProductionBlocked ? 'text-gray-400' : isSelected ? 'text-emerald-600' : 'text-gray-700'}`}>
                    {preset.label}
                  </span>
                  {isSelected && !isProductionBlocked && <span className="text-emerald-500 text-sm">✓</span>}
                </div>
                <p className="text-sm text-gray-500 mb-2">{preset.description}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                  <span>参加人数：{preset.required_players}名</span>
                  <span>回戦数：{preset.game_count}回</span>
                  <span>札作成枚数：{preset.cards_per_user}枚/人</span>
                  <span>配布手札：{preset.hand_cards_per_player}枚/人</span>
                </div>
                {isProductionBlocked && (
                  <p className="text-xs text-red-400 mt-2">進行中の本番大会があります</p>
                )}
              </button>
            )
          })}
        </div>

        {/* 本番モード：カスタム設定 */}
        {selectedPreset.mode === 'production' && !activeProductionTournament && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-4">
            <p className="text-xs font-medium text-gray-600">本番設定</p>

            {/* 札のソース選択 */}
            <div className="space-y-2">
              {(
                [
                  { value: 'new', label: '札を作成する', disabled: false },
                  { value: 'previous', label: '前回大会の札を使用する', disabled: !hasPastTournaments },
                  { value: 'all', label: '全大会の札を使用する', disabled: !hasPastTournaments },
                  { value: 'unused_submission', label: '全大会の未使用札（作品として未使用）', disabled: !hasPastTournaments },
                  { value: 'unused_complete', label: '全大会の未使用札（完全に未使用）', disabled: !hasPastTournaments },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 text-sm cursor-pointer ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="cardSource"
                    value={opt.value}
                    checked={cardSource === opt.value}
                    disabled={opt.disabled}
                    onChange={() => setCardSource(opt.value)}
                    className="accent-emerald-500"
                  />
                  <span className={cardSource === opt.value && !opt.disabled ? 'text-emerald-700 font-medium' : 'text-gray-600'}>
                    {opt.label}
                  </span>
                </label>
              ))}

            {/* 未使用札枚数バリデーション */}
            {(cardSource === 'unused_submission' || cardSource === 'unused_complete') && (
              <div className={`text-xs rounded-lg px-3 py-2 mt-1 ${
                checkingCards
                  ? 'bg-gray-50 text-gray-400'
                  : unusedCardInfo === null
                  ? 'bg-gray-50 text-gray-400'
                  : unusedCardInfo.available >= unusedCardInfo.required
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-600'
              }`}>
                {checkingCards ? '枚数を確認中...' : unusedCardInfo === null ? '' : (
                  <>
                    利用可能：<span className="font-bold">{unusedCardInfo.available}枚</span>
                    　／　必要：<span className="font-bold">{unusedCardInfo.required}枚</span>
                    {unusedCardInfo.available < unusedCardInfo.required && (
                      <span className="block mt-1 font-medium">未使用の札が不足しているため発行できません</span>
                    )}
                  </>
                )}
              </div>
            )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">回戦数</label>
                <input
                  type="number"
                  min={1}
                  value={prodGameCount}
                  onChange={(e) => setProdGameCount(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className={`text-xs mb-1 block ${cardSource !== 'new' ? 'text-gray-300' : 'text-gray-500'}`}>
                  札作成枚数
                </label>
                <input
                  type="number"
                  min={1}
                  value={prodCardsPerUser}
                  disabled={cardSource !== 'new'}
                  onChange={(e) => setProdCardsPerUser(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">配布手札</label>
                <input
                  type="number"
                  min={1}
                  value={prodHandCards}
                  onChange={(e) => setProdHandCards(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-pink-400 mb-1 block">下ネタ枠数</label>
                <input
                  type="number"
                  min={0}
                  value={prodDirtyCards}
                  onChange={(e) => setProdDirtyCards(e.target.value)}
                  className="w-full border border-pink-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-pink-400 bg-pink-50"
                />
              </div>
            </div>
          </div>
        )}

        {/* 投票モード選択（全モード共通） */}
        <div className="mb-4">
          <p className="text-sm text-gray-700 font-medium mb-2">投票モード</p>
          <div className="space-y-2">
            {([
              { value: 'normal', label: '通常', desc: '作者名が投票画面に表示されます' },
              { value: 'secret_one', label: 'シークレット（1回のみ）', desc: 'ランダムな1回戦のみ作者名を非表示' },
              { value: 'secret_all', label: 'シークレット（全回戦）', desc: '全回戦で作者名を非表示' },
              { value: 'impersonation', label: 'なりすまし', desc: '投稿時に任意のユーザー名で出品できる' },
              { value: 'random_per_round', label: '🎲 ランダム', desc: '回戦ごとに通常・シークレット・なりすましをランダムで割り振る' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setVotingStyle(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                  votingStyle === opt.value ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  votingStyle === opt.value ? 'border-emerald-500' : 'border-gray-300'
                }`}>
                  {votingStyle === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                </div>
                <div>
                  <p className={`text-sm font-medium ${votingStyle === opt.value ? 'text-emerald-700' : 'text-gray-700'}`}>{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 決戦方法選択 */}
        <div className="mb-4">
          <p className="text-sm text-gray-700 font-medium mb-2">決戦方法（同票2作品時）</p>
          <div className="space-y-2">
            {([
              { value: 'vote', label: '決選投票', desc: '参加者（作者除く）が同票2作品に再投票して決める' },
              { value: 'button_mash', label: '⚡ 連打ゲーム', desc: '決戦2名が3秒間の連打数を競う。+1票廃止' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTiebreakerMode(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                  tiebreakerMode === opt.value ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  tiebreakerMode === opt.value ? 'border-red-500' : 'border-gray-300'
                }`}>
                  {tiebreakerMode === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                </div>
                <div>
                  <p className={`text-sm font-medium ${tiebreakerMode === opt.value ? 'text-red-700' : 'text-gray-700'}`}>{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {activeProductionTournament && selectedPreset.mode === 'production' && (
          <p className="text-xs text-red-400 text-center mb-3">
            本番大会が進行中のため、新たに発行できません
          </p>
        )}
        <button
          onClick={handleCreate}
          disabled={
            loading ||
            (selectedPreset.mode === 'production' && !!activeProductionTournament) ||
            ((cardSource === 'unused_submission' || cardSource === 'unused_complete') &&
              (checkingCards || (unusedCardInfo !== null && unusedCardInfo.available < unusedCardInfo.required)))
          }
          className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '発行中...' : '大会URLを発行する'}
        </button>

        {/* 進行中の本番大会への参加催促通知 */}
        {activeProductionTournament && activeProductionTournament.status === 'waiting_users' && (
          <div className="mt-4">
            <button
              onClick={handleNotifyStart}
              disabled={notifying}
              className="w-full py-3 bg-blue-500 text-white font-medium text-sm rounded-xl hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {notifying ? '送信中...' : '参加催促通知を送る（LINE）'}
            </button>
            {notified && (
              <p className="text-center text-xs text-blue-600 mt-2">✓ 通知を送信しました</p>
            )}
          </div>
        )}

        {generatedUrl && (
          <div className="mt-6 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
            <p className="text-xs text-gray-500 mb-1">発行されたURL（{selectedPreset.label}）</p>
            <p className="text-sm font-mono text-emerald-700 break-all mb-3">{generatedUrl}</p>
            <button
              onClick={handleCopy}
              className="w-full py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors"
            >
              {copied ? 'コピーしました！' : 'URLをコピー'}
            </button>
          </div>
        )}

        {/* データリセット */}
        <div className="mt-10 pt-6 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-3">危険な操作</p>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="w-full py-3 bg-white text-red-500 font-medium text-sm rounded-xl border-2 border-red-200 hover:bg-red-50 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resetting ? 'リセット中...' : 'テストデータをリセット（本番は保持）'}
          </button>
          {resetDone && (
            <p className="text-center text-xs text-green-600 mt-2">✓ リセット完了・一覧を更新しました</p>
          )}
          <p className="text-xs text-gray-400 mt-2 text-center">
            ソロ・2名テストのみ削除。本番・ユーザーデータは保持されます
          </p>
        </div>

        {/* 大会一覧 */}
        <div className="mt-10 pt-6 border-t border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">大会一覧</p>
            <button
              onClick={fetchTournaments}
              disabled={listLoading}
              className="text-xs text-emerald-500 hover:text-emerald-600 disabled:opacity-40"
            >
              {listLoading ? '更新中...' : '更新'}
            </button>
          </div>

          {listLoading && tournaments.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">読み込み中...</p>
          ) : tournaments.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">大会がありません</p>
          ) : (
            <div className={`space-y-2 transition-opacity ${listLoading ? 'opacity-50' : 'opacity-100'}`}>
              {tournaments.map((t) => (
                <div key={t.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* モードと大会番号 */}
                      {t.mode === 'production' && t.productionNumber ? (
                        <span className="text-xs font-bold text-gray-700">
                          本番 第{t.productionNumber}回大会
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-gray-500">
                          {MODE_LABEL[t.mode] ?? t.mode}
                        </span>
                      )}
                      {/* ステータス */}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.status === 'finished'
                          ? 'bg-gray-100 text-gray-400'
                          : t.status === 'playing'
                          ? 'bg-emerald-100 text-emerald-600'
                          : 'bg-yellow-100 text-yellow-600'
                      }`}>
                        {t.status === 'playing' && t.currentGame
                          ? `第${t.currentGame.round_number}回戦 ${GAME_STATUS_LABEL[t.currentGame.status] ?? t.currentGame.status}`
                          : STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      {/* 投票モードバッジ */}
                      {t.random_voting && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-600">🎲 ランダム</span>
                      )}
                      {!t.random_voting && t.impersonation_mode && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-600">🎭 なりすまし</span>
                      )}
                      {!t.random_voting && t.secret_voting && t.secret_round === null && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">🕵️ 全回シークレット</span>
                      )}
                      {!t.random_voting && t.secret_voting && t.secret_round !== null && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">🕵️ 第{t.secret_round}回シークレット</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-300 shrink-0">
                      {new Date(t.created_at).toLocaleDateString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {t.mode === 'production' && (
                    <div className="flex gap-3 text-xs text-gray-400 mb-2 flex-wrap">
                      <span>全{t.game_count}回戦</span>
                      <span>札作成枚数：{t.cards_per_user}</span>
                      <span>手札数：{t.hand_cards_per_player}</span>
                      <span className={t.dirty_cards_per_user > 0 ? 'text-pink-400' : ''}>
                        下ネタ枠：{t.dirty_cards_per_user}
                      </span>
                    </div>
                  )}
                  {t.allGames && t.allGames.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs text-gray-400 mb-1">ゲーム一覧</p>
                      <div className="space-y-0.5">
                        {t.allGames.map((g, i) => {
                          const modeEmoji = g.voting_mode === 'impersonation' ? '🎭' : g.voting_mode === 'secret' ? '🕵️' : g.voting_mode === 'normal' ? '🎯' : '—'
                          const modeLabel = g.voting_mode === 'impersonation' ? 'なりすまし' : g.voting_mode === 'secret' ? 'シークレット' : g.voting_mode === 'normal' ? '通常' : 'なし'
                          const isActive = g.status !== 'finished'
                          return (
                            <div key={i} className={`flex items-center gap-2 text-xs px-2 py-0.5 rounded ${isActive ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                              <span className={`font-medium ${isActive ? 'text-emerald-700' : 'text-gray-500'}`}>
                                {g.is_rematch ? `↩ ${g.round_number}回戦 再戦` : `${g.round_number}回戦`}
                              </span>
                              <span className={`${g.voting_mode === 'impersonation' ? 'text-purple-600 font-bold' : 'text-gray-500'}`}>
                                {modeEmoji} {modeLabel}
                              </span>
                              <span className="text-gray-300 ml-auto">{GAME_STATUS_LABEL[g.status] ?? g.status}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono text-gray-400 truncate flex-1">
                      /{t.token}
                    </p>
                    <button
                      onClick={() => copyTournamentUrl(t.token)}
                      className="text-xs px-3 py-1 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shrink-0"
                    >
                      {copiedToken === t.token ? 'コピー済' : 'URLコピー'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI総評 手動生成 */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mt-4">
          <h2
            className="text-sm font-bold text-gray-700 mb-3 select-none"
            onClick={() => {
              const next = forceRegenTapCount + 1
              setForceRegenTapCount(next)
              if (next >= 5) {
                setShowForceRegen(true)
                setForceRegenTapCount(0)
              }
            }}
          >
            🤖 AI個人総評
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            大会終了時に自動生成されますが、手動でも実行できます。<br />
            新しい大会が終了済みの場合のみ再生成されます。
          </p>
          <button
            onClick={async () => {
              setGeneratingComments(true)
              setCommentGenResult(null)
              const res = await fetch('/api/ai/generate-comments', { method: 'POST' })
              const data = await res.json()
              if (data.upToDate) setCommentGenResult('✅ 既に最新の総評です')
              else if (data.success) setCommentGenResult(`✅ ${data.generated}名分の総評を生成しました`)
              else if (data.message) setCommentGenResult(`ℹ️ ${data.message}`)
              else setCommentGenResult('❌ 生成に失敗しました')
              setGeneratingComments(false)
            }}
            disabled={generatingComments}
            className="w-full py-2.5 bg-purple-500 text-white font-bold rounded-xl text-sm disabled:opacity-50"
          >
            {generatingComments ? '生成中...' : '🤖 AI総評を生成する'}
          </button>
          {commentGenResult && (
            <p className="text-xs text-gray-500 mt-2 text-center">{commentGenResult}</p>
          )}
          {showForceRegen && (
            <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
              <p className="text-[10px] text-gray-400 text-center">APIコストが発生します。本当に再生成しますか？</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowForceRegen(false)}
                  className="flex-1 py-2 bg-gray-100 text-gray-500 font-bold rounded-xl text-xs"
                >
                  キャンセル
                </button>
                <button
                  onClick={async () => {
                    setGeneratingComments(true)
                    setCommentGenResult(null)
                    const res = await fetch('/api/ai/generate-comments?force=true', { method: 'POST' })
                    const data = await res.json()
                    if (data.success) setCommentGenResult(`✅ ${data.generated}名分の総評を強制再生成しました`)
                    else setCommentGenResult('❌ 生成に失敗しました')
                    setGeneratingComments(false)
                    setShowForceRegen(false)
                  }}
                  disabled={generatingComments}
                  className="flex-1 py-2 bg-red-500 text-white font-bold rounded-xl text-xs disabled:opacity-50"
                >
                  強制再生成する
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-8">v1.36.12</p>
      </div>
    </div>
  )
}
