'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface User {
  id: string
  name: string
}

interface Game {
  id: string
  round_number: number
}

interface ButtonMashResult {
  user_id: string
  tap_count: number
  mash_round: number
}

interface Props {
  token: string
  game: Game
  currentUserId: string
  participants: User[]
  onCompleted: () => Promise<void>
}

const MASH_DURATION_MS = 3000

export default function ButtonMash({
  token,
  game,
  currentUserId,
  participants,
  onCompleted,
}: Props) {
  const [tiebreakerUserIds, setTiebreakerUserIds] = useState<string[]>([])
  const [mashRound, setMashRound] = useState(1)
  const [tapCount, setTapCount] = useState(0)
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [timeLeft, setTimeLeft] = useState(MASH_DURATION_MS)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<ButtonMashResult[]>([])
  const [opponentDone, setOpponentDone] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const endTimeRef = useRef<number>(0)
  const savedMashRoundRef = useRef(0)

  const getName = (id: string) => participants.find((p) => p.id === id)?.name ?? '???'

  // 初回投票で同票の2作品の作者IDを取得
  useEffect(() => {
    supabase
      .from('votes')
      .select('submission_id')
      .eq('game_id', game.id)
      .eq('is_tiebreaker', false)
      .then(async ({ data: votes }) => {
        const count: Record<string, number> = {}
        for (const v of votes ?? []) {
          count[v.submission_id] = (count[v.submission_id] ?? 0) + 1
        }
        const max = Math.max(...Object.values(count), 0)
        const tiedIds = Object.entries(count).filter(([, c]) => c === max).map(([id]) => id)
        const { data: subs } = await supabase
          .from('submissions')
          .select('user_id')
          .in('id', tiedIds)
        setTiebreakerUserIds((subs ?? []).map((s) => s.user_id))
      })
  }, [game.id])

  const isContestant = tiebreakerUserIds.includes(currentUserId)
  const opponentId = tiebreakerUserIds.find((id) => id !== currentUserId) ?? null

  // 参加者向けポーリング（相手の完了を検知）
  useEffect(() => {
    if (!isContestant || !opponentId) return
    const poll = setInterval(async () => {
      const res = await fetch(`/api/tournaments/${token}/button-mash?game_id=${game.id}`)
      const json = await res.json()
      const allResults: ButtonMashResult[] = json.results ?? []
      const latestRound = allResults.length > 0
        ? Math.max(...allResults.map((r) => r.mash_round))
        : 1
      setMashRound(latestRound)
      setResults(allResults)
      const opponentResult = allResults.find(
        (r) => r.user_id === opponentId && r.mash_round === latestRound,
      )
      if (opponentResult) setOpponentDone(true)
    }, 2000)
    return () => clearInterval(poll)
  }, [token, game.id, isContestant, opponentId])

  // 非参加者向けポーリング（全完了を検知してadvanceを呼ぶ）
  useEffect(() => {
    if (isContestant || tiebreakerUserIds.length === 0) return
    const poll = setInterval(async () => {
      const res = await fetch(`/api/tournaments/${token}/button-mash?game_id=${game.id}`)
      const json = await res.json()
      const allResults: ButtonMashResult[] = json.results ?? []
      if (allResults.length === 0) return
      const latestRound = Math.max(...allResults.map((r) => r.mash_round))
      setResults(allResults)
      const latestResults = allResults.filter((r) => r.mash_round === latestRound)
      if (latestResults.length >= tiebreakerUserIds.length) {
        await onCompleted()
      }
    }, 2000)
    return () => clearInterval(poll)
  }, [token, game.id, isContestant, tiebreakerUserIds.length, onCompleted])

  const saveResult = useCallback(
    async (count: number, round: number) => {
      if (savedMashRoundRef.current === round) return
      savedMashRoundRef.current = round
      setSaving(true)
      await fetch(`/api/tournaments/${token}/button-mash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: game.id,
          user_id: currentUserId,
          tap_count: count,
          mash_round: round,
        }),
      })
      setSaving(false)
      await onCompleted()
    },
    [token, game.id, currentUserId, onCompleted],
  )

  const handleTap = () => {
    if (finished) return

    if (!started) {
      setStarted(true)
      endTimeRef.current = Date.now() + MASH_DURATION_MS
      setTapCount(1)

      timerRef.current = setInterval(() => {
        const remaining = endTimeRef.current - Date.now()
        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current)
          setTimeLeft(0)
          setFinished(true)
          setTapCount((prev) => {
            saveResult(prev, mashRound)
            return prev
          })
        } else {
          setTimeLeft(remaining)
        }
      }, 50)
      return
    }

    setTapCount((prev) => prev + 1)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // 同点再戦：mashRoundが上がったらリセット
  useEffect(() => {
    if (mashRound <= 1) return
    setTapCount(0)
    setStarted(false)
    setFinished(false)
    setTimeLeft(MASH_DURATION_MS)
    setOpponentDone(false)
    savedMashRoundRef.current = 0
  }, [mashRound])

  const latestResults = results.filter((r) => r.mash_round === mashRound)
  const opponentResult = latestResults.find((r) => r.user_id === opponentId)

  // ローディング中
  if (tiebreakerUserIds.length === 0) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm">読み込み中...</div>
    )
  }

  // 非参加者の待機画面
  if (!isContestant) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-red-500 rounded-2xl p-4 text-center">
          <p className="text-red-100 text-xs font-bold mb-0.5">第{game.round_number}回戦</p>
          <h2 className="text-white text-lg font-bold">⚔️ 連打決戦</h2>
        </div>
        <div className="bg-gray-50 rounded-2xl p-8 text-center space-y-3">
          <p className="text-4xl">⚔️</p>
          <p className="text-gray-700 font-bold text-lg">現在決戦中！</p>
          <p className="text-gray-500 text-sm">結果が出るまでお待ちください</p>
          <div className="mt-4 space-y-2">
            {tiebreakerUserIds.map((uid) => {
              const done = latestResults.some((r) => r.user_id === uid)
              return (
                <div key={uid} className="flex items-center justify-between bg-white rounded-xl px-4 py-2 border border-gray-100">
                  <span className="text-sm font-medium text-gray-700">{getName(uid)}</span>
                  <span className={`text-xs font-bold ${done ? 'text-green-500' : 'text-gray-400'}`}>
                    {done ? '✓ 完了' : '連打中...'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const progressPct = started && !finished
    ? ((MASH_DURATION_MS - timeLeft) / MASH_DURATION_MS) * 100
    : finished ? 100 : 0

  return (
    <div className="p-4 space-y-4">
      <div className="bg-red-500 rounded-2xl p-4 text-center">
        <p className="text-red-100 text-xs font-bold mb-0.5">
          第{game.round_number}回戦{mashRound > 1 ? ` / 再戦${mashRound}回目` : ''}
        </p>
        <h2 className="text-white text-lg font-bold">⚔️ 連打決戦</h2>
      </div>

      {mashRound > 1 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-center">
          <p className="text-orange-700 text-sm font-bold">同点！再戦 {mashRound} 回目</p>
        </div>
      )}

      <div className="bg-red-50 rounded-xl px-4 py-3 text-center">
        <p className="text-red-700 text-sm font-medium">
          {!started
            ? '🎮 ボタンを押してスタート！3秒間連打しよう'
            : finished
            ? '⏱️ 終了！'
            : `残り ${(timeLeft / 1000).toFixed(1)} 秒`}
        </p>
      </div>

      {/* プログレスバー */}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-red-500 transition-all duration-50"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* タップ回数 */}
      <div className="text-center">
        <p className="text-6xl font-black text-red-500">{tapCount}</p>
        <p className="text-gray-400 text-sm mt-1">回</p>
      </div>

      {/* 連打ボタン */}
      <div className="flex justify-center py-4">
        <button
          onPointerDown={(e) => { e.preventDefault(); handleTap() }}
          disabled={finished}
          className={`w-48 h-48 rounded-full font-black text-white text-2xl shadow-2xl transition-all select-none
            ${finished
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-red-500 hover:bg-red-600 active:scale-95 active:shadow-inner cursor-pointer'
            }`}
          style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
        >
          {finished ? '終了' : started ? '連打！' : 'スタート'}
        </button>
      </div>

      {/* 結果・待機状態 */}
      {finished && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">あなた（{getName(currentUserId)}）</span>
            <span className="text-sm font-bold text-red-500">{tapCount} 回</span>
          </div>
          {opponentId && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{getName(opponentId)}</span>
              <span className={`text-sm font-bold ${opponentDone ? 'text-red-500' : 'text-gray-400'}`}>
                {opponentDone && opponentResult ? `${opponentResult.tap_count} 回` : '連打中...'}
              </span>
            </div>
          )}
        </div>
      )}

      {saving && (
        <p className="text-center text-xs text-gray-400">結果を保存中...</p>
      )}
    </div>
  )
}
