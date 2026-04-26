'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import UserSelection from '@/components/UserSelection'
import CardCreation from '@/components/CardCreation'
import GamePlay from '@/components/GamePlay'
import Voting from '@/components/Voting'
import Results from '@/components/Results'
import Archive from '@/components/Archive'
import TournamentFinished from '@/components/TournamentFinished'
import PrevRoundBanner from '@/components/PrevRoundBanner'
import type { TournamentStatus, GameStatus } from '@/types/database'

interface Tournament {
  id: string
  token: string
  status: TournamentStatus
  required_players: number
  game_count: number
  cards_per_user: number
  hand_cards_per_player: number
  mode: string
}

interface Game {
  id: string
  round_number: number
  status: GameStatus
  topic_card_id: string
}

interface User {
  id: string
  name: string
}

export default function TournamentPage() {
  const params = useParams()
  const token = params.token as string
  const { userId, saveUser, clearUser } = useCurrentUser(token)

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [currentGame, setCurrentGame] = useState<Game | null>(null)
  const [participants, setParticipants] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'game' | 'archive'>('game')
  const [notFound, setNotFound] = useState(false)
  const [tournamentNumber, setTournamentNumber] = useState<number | null>(null)

  // 初回ロード時に一度だけadvanceを試みるためのフラグ
  const hasTriedAdvance = useRef(false)

  const fetchState = useCallback(async () => {
    const { data: t } = await supabase
      .from('tournaments')
      .select('*')
      .eq('token', token)
      .single()

    if (!t) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setTournament(t)

    if (t.mode === 'production') {
      const { data: prodTourneys } = await supabase
        .from('tournaments')
        .select('id')
        .eq('mode', 'production')
        .order('created_at', { ascending: true })
      const idx = (prodTourneys ?? []).findIndex((pt) => pt.id === t.id)
      setTournamentNumber(idx >= 0 ? idx + 1 : null)
    }

    const { data: partRows } = await supabase
      .from('tournament_participants')
      .select('users(id, name)')
      .eq('tournament_id', t.id)

    setParticipants(
      (partRows ?? []).map((r) => (r.users as unknown as User)).filter(Boolean)
    )

    if (t.status === 'playing' || t.status === 'finished') {
      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('tournament_id', t.id)
        .order('round_number', { ascending: false })
        .limit(1)
        .single()

      setCurrentGame(game ?? null)
    }

    setLoading(false)
  }, [token])

  // 初回マウント時にデータ取得 + 状態を自動進行（1回のみ）
  useEffect(() => {
    async function init() {
      await Promise.all([
        supabase.from('users').select('*').then(({ data }) => {
          setAllUsers(data ?? [])
        }),
        fetchState(),
      ])

      if (!hasTriedAdvance.current) {
        hasTriedAdvance.current = true
        const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
        const data = await res.json()
        if (data.advanced) {
          await fetchState()
        }
      }
    }

    init()
  }, [fetchState, token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-2xl mb-2">🎴</p>
          <p className="text-gray-600">大会が見つかりません</p>
        </div>
      </div>
    )
  }

  if (!tournament) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-100 px-4 py-2 sticky top-0 z-10">
        <div className="relative flex justify-center items-center">
          <img src="/omojan_logo.png" alt="おもじゃん for 男根祭" className="h-10 w-auto" />
          {tournamentNumber && (
            <span className="absolute left-0 bottom-0 text-xs font-bold text-yellow-700 bg-yellow-50 border border-yellow-300 px-2 py-0.5 rounded-full">
              第{tournamentNumber}回大会
            </span>
          )}
          {tournament.status === 'playing' && currentGame && (
            <span className={`absolute right-0 bottom-0 text-xs font-bold px-2 py-0.5 rounded-full border ${
              currentGame.round_number === tournament.game_count
                ? 'text-red-600 bg-red-50 border-red-300'
                : 'text-emerald-600 bg-emerald-50 border-emerald-200'
            }`}>
              {currentGame.round_number === tournament.game_count
                ? '最終戦'
                : `${currentGame.round_number} / ${tournament.game_count}回戦`}
            </span>
          )}
        </div>
      </header>

      <div className="max-w-md mx-auto">
        {/* ユーザー選択フェーズ */}
        {tournament.status === 'waiting_users' && (
          <UserSelection
            tournament={tournament}
            allUsers={allUsers}
            participants={participants}
            currentUserId={userId}
            onJoin={async (uid) => {
              await fetch(`/api/tournaments/${token}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: uid }),
              })
              saveUser(uid)
              await fetchState()
              const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
              const data = await res.json()
              if (data.advanced) await fetchState()
            }}
            onLeave={async (uid) => {
              await fetch(`/api/tournaments/${token}/join`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: uid }),
              })
              clearUser()
              await fetchState()
            }}
          />
        )}

        {/* 札作成フェーズ */}
        {tournament.status === 'creating_cards' && userId && (
          <CardCreation
            tournament={tournament}
            token={token}
            currentUserId={userId}
            participants={participants}
            onSubmitted={async () => {
              const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
              const data = await res.json()
              if (data.advanced) await fetchState()
              else await fetchState()
            }}
          />
        )}

        {/* ゲームプレイフェーズ */}
        {tournament.status === 'playing' && currentGame && userId && (
          <>
            {/* タブ（2回戦以降） */}
            {currentGame.round_number > 1 && (
              <div className="flex border-b border-gray-200 bg-white sticky top-[57px] z-10">
                <button
                  onClick={() => setActiveTab('game')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'game' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
                  }`}
                >
                  現在のゲーム
                </button>
                <button
                  onClick={() => setActiveTab('archive')}
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'archive' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-gray-400'
                  }`}
                >
                  過去結果
                </button>
              </div>
            )}

            {activeTab === 'archive' ? (
              <Archive tournamentId={tournament.id} participants={participants} />
            ) : currentGame.status === 'waiting_submission' ? (
              <>
                {currentGame.round_number > 1 && (
                  <PrevRoundBanner
                    tournamentId={tournament.id}
                    prevRoundNumber={currentGame.round_number - 1}
                  />
                )}
                <GamePlay
                  tournament={tournament}
                  token={token}
                  game={currentGame}
                  currentUserId={userId}
                  participants={participants}
                  onSubmitted={async () => {
                    const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
                    const data = await res.json()
                    if (data.advanced) await fetchState()
                    else await fetchState()
                  }}
                />
              </>
            ) : currentGame.status === 'waiting_vote' ? (
              <Voting
                tournament={tournament}
                token={token}
                game={currentGame}
                currentUserId={userId}
                participants={participants}
                onVoted={async () => {
                  const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
                  const data = await res.json()
                  if (data.advanced) await fetchState()
                  else await fetchState()
                }}
              />
            ) : (
              <Results
                tournament={tournament}
                token={token}
                game={currentGame}
                currentUserId={userId}
                participants={participants}
                onNext={async () => {
                  const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
                  const data = await res.json()
                  if (data.advanced) await fetchState()
                }}
              />
            )}
          </>
        )}

        {/* 大会終了画面 */}
        {tournament.status === 'finished' && (
          <TournamentFinished
            tournamentId={tournament.id}
            participants={participants}
          />
        )}
      </div>

      {/* フッター */}
      <footer className="text-center py-4 mt-4">
        <p className="text-xs text-gray-300">v1.3.3</p>
      </footer>
    </div>
  )
}
