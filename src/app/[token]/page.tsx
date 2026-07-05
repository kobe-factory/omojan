'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { USERS } from '@/config/game'
import UserSelection from '@/components/UserSelection'
import CardCreation from '@/components/CardCreation'
import GamePlay from '@/components/GamePlay'
import Voting from '@/components/Voting'
import ButtonMash from '@/components/ButtonMash'
import Results from '@/components/Results'
import Archive from '@/components/Archive'
import TournamentFinished from '@/components/TournamentFinished'
import type { TournamentStatus, GameStatus } from '@/types/database'

function RejoinScreen({ participants, onRejoin }: { participants: { id: string; name: string }[]; onRejoin: (id: string) => void }) {
  const [selecting, setSelecting] = useState(false)
  const [pendingUser, setPendingUser] = useState<{ id: string; name: string } | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleConfirm() {
    if (password !== 'dankon') {
      setError('パスワードが違います')
      return
    }
    if (pendingUser) {
      onRejoin(pendingUser.id)
      setPendingUser(null)
      setPassword('')
      setError('')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      {/* パスワード確認ダイアログ */}
      {pendingUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl">
            <p className="text-gray-800 font-bold text-center mb-2">参加確認</p>
            <p className="text-gray-600 text-sm text-center mb-4">
              <span className="font-bold text-violet-600">{pendingUser.name}</span> で参加します。<br />パスワードを入力してください。
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="パスワード"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm mb-2 focus:outline-none focus:border-violet-400"
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              autoFocus
            />
            {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => { setPendingUser(null); setPassword(''); setError('') }}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium text-sm"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-3 rounded-xl bg-violet-500 text-white font-bold text-sm"
              >
                参加する
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-4xl mb-4">🎴</p>
      <p className="text-gray-700 font-medium mb-2">この大会はすでに参加者が確定しています</p>
      {!selecting ? (
        <>
          <p className="text-sm text-gray-400 mb-6">機種変更などで認識できなくなった場合は、参加者として再認証できます</p>
          <button
            onClick={() => setSelecting(true)}
            className="px-5 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold"
          >
            参加済みの方はこちら
          </button>
        </>
      ) : (
        <div className="w-full max-w-xs mt-4">
          <p className="text-sm text-gray-500 mb-3">あなたはどのプレイヤーですか？</p>
          <div className="space-y-2">
            {participants.map((p) => (
              <button
                key={p.id}
                onClick={() => setPendingUser(p)}
                className="w-full py-3 rounded-xl bg-white border border-violet-300 text-violet-700 font-bold text-sm shadow-sm active:scale-95"
              >
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={() => setSelecting(false)} className="mt-4 text-xs text-gray-400 underline">キャンセル</button>
        </div>
      )}
    </div>
  )
}

const VOTING_MODE_INFO = {
  normal:        { emoji: '🎯', label: '通常モード',       desc: '作者名が表示されます',           bg: 'bg-sky-50',    border: 'border-sky-300',    text: 'text-sky-700' },
  secret:        { emoji: '🕵️', label: 'シークレットモード', desc: '作者名は非表示です',             bg: 'bg-gray-50',   border: 'border-gray-300',   text: 'text-gray-700' },
  impersonation: { emoji: '🎭', label: 'なりすましモード',   desc: '他のユーザーとして投稿できます', bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' },
}



interface Tournament {
  id: string
  token: string
  status: TournamentStatus
  required_players: number
  game_count: number
  cards_per_user: number
  hand_cards_per_player: number
  dirty_cards_per_user: number
  skip_card_creation: boolean
  secret_voting: boolean
  secret_round: number | null
  impersonation_mode: boolean
  random_voting: boolean
  tiebreaker_mode: string
  mode: string
  tournament_type: string | null
}

interface Game {
  id: string
  round_number: number
  status: GameStatus
  topic_card_id: string
  is_rematch: boolean
  voting_mode: string | null
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
  const [prevResultGame, setPrevResultGame] = useState<Game | null>(null)
  const [rematchNoticeGame, setRematchNoticeGame] = useState<Game | null>(null)

  const [lineUserId, setLineUserId] = useState<string | null>(null)

  // 初回ロード時に一度だけadvanceを試みるためのフラグ
  const hasTriedAdvance = useRef(false)
  const hasSavedLineId = useRef(false)

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
        .select('id, tournament_type')
        .eq('mode', 'production')
        .order('created_at', { ascending: true })
      if (t.tournament_type === 'exhibition') {
        const exhibitionOnly = (prodTourneys ?? []).filter((pt) => pt.tournament_type === 'exhibition')
        const idx = exhibitionOnly.findIndex((pt) => pt.id === t.id)
        setTournamentNumber(idx >= 0 ? idx + 1 : null)
      } else {
        const normalOnly = (prodTourneys ?? []).filter((pt) => pt.tournament_type !== 'exhibition')
        const idx = normalOnly.findIndex((pt) => pt.id === t.id)
        setTournamentNumber(idx >= 0 ? idx + 1 : null)
      }
    }

    const { data: partRows } = await supabase
      .from('tournament_participants')
      .select('users(id, name)')
      .eq('tournament_id', t.id)

    setParticipants(
      (partRows ?? []).map((r) => (r.users as unknown as User)).filter(Boolean)
    )

    if (t.status === 'playing' || t.status === 'finished') {
      const { data: games } = await supabase
        .from('games')
        .select('*')
        .eq('tournament_id', t.id)
        .gt('round_number', 0)
        .order('round_number', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)

      setCurrentGame(games?.[0] ?? null)
    } else if (t.status === 'final_tiebreaker') {
      const { data: finalGame } = await supabase
        .from('games')
        .select('*')
        .eq('tournament_id', t.id)
        .eq('round_number', 0)
        .maybeSingle()

      setCurrentGame(finalGame ?? null)
    }

    setLoading(false)
  }, [token])

  // LIFF init → LINE User ID 取得
  // /current経由の場合はsessionStorageから取得、直接アクセスの場合はLIFF initで取得
  useEffect(() => {
    const stored = sessionStorage.getItem('omojan:pendingLineUserId')
    if (stored) {
      sessionStorage.removeItem('omojan:pendingLineUserId')
      setLineUserId(stored)
      return
    }

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) return

    import('@line/liff').then(({ default: liff }) => {
      liff.init({ liffId }).then(() => {
        if (!liff.isInClient()) return
        return liff.getProfile().then((profile) => setLineUserId(profile.userId))
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  // userId と lineUserId が揃ったらDBに保存（1回のみ）
  useEffect(() => {
    if (!userId || !lineUserId || hasSavedLineId.current) return
    hasSavedLineId.current = true
    fetch(`/api/users/${userId}/line-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_user_id: lineUserId }),
    }).catch(() => {})
  }, [userId, lineUserId])

  // 初回マウント時にデータ取得 + 状態を自動進行（1回のみ）
  useEffect(() => {
    async function init() {
      await Promise.all([
        supabase.from('users').select('*').then(({ data }) => {
          setAllUsers((data ?? []).filter((u) => (USERS as readonly string[]).includes(u.name)))
        }),
        fetchState(),
      ])

      if (!hasTriedAdvance.current) {
        hasTriedAdvance.current = true
        // ソロモードでは waiting_submission→waiting_vote→next と複数段階あるため
        // 進めなくなるまでループして advance を試みる
        for (let i = 0; i < 5; i++) {
          const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
          const data = await res.json()
          if (data.advanced) {
            await fetchState()
          } else {
            break
          }
        }
      }
    }

    init()
  }, [fetchState, token])

  // Supabase Realtime: 関連テーブルの変更を購読して自動的に画面を更新
  useEffect(() => {
    if (!tournament) return

    const channel = supabase
      .channel(`tournament-${tournament.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournament.id}` },
        () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${tournament.id}` },
        () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants', filter: `tournament_id=eq.${tournament.id}` },
        () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' },
        () => fetchState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' },
        async () => {
          await fetchState()
          // advance を再試行（最後の投票者の advance が失敗した場合のスタック防止）
          const res = await fetch(`/api/tournaments/${token}/advance`, { method: 'POST' })
          const data = await res.json()
          if (data.advanced) await fetchState()
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tournament, fetchState])

  // waiting_users フェーズ中のみポーリング（Realtimeの取りこぼし保険）
  useEffect(() => {
    if (tournament?.status !== 'waiting_users') return
    const timer = setInterval(() => fetchState(), 10000)
    return () => clearInterval(timer)
  }, [tournament?.status, fetchState])

  // 大会切り替え時にlocalStorageの古いゲームデータを削除
  useEffect(() => {
    if (!tournament?.id) return
    if (typeof window === 'undefined') return
    const activeKey = 'omojan:active_tournament'
    const prev = localStorage.getItem(activeKey)
    if (prev && prev !== tournament.id) {
      const toDelete: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (
          k.startsWith('omojan:shuffle:') ||
          k.startsWith('omojan:handorder:') ||
          k.startsWith('omojan:draft:submission:') ||
          k.startsWith('omojan:result_seen:')
        )) toDelete.push(k)
      }
      toDelete.forEach((k) => localStorage.removeItem(k))
    }
    localStorage.setItem(activeKey, tournament.id)
  }, [tournament?.id])

  // 前戦の結果モーダル表示チェック（作品投稿中フェーズに入ったとき、未確認なら前戦結果を表示）
  useEffect(() => {
    if (!tournament || !currentGame) return
    if (currentGame.status !== 'waiting_submission') return
    if (currentGame.round_number <= 1) return

    const prevRound = currentGame.round_number - 1
    const key = `omojan:result_seen:${tournament.id}:${prevRound}`
    if (typeof window !== 'undefined' && localStorage.getItem(key)) return

    supabase
      .from('games')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('round_number', prevRound)
      .in('status', ['showing_result', 'finished', 'showing_rematch'])
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setPrevResultGame(data[0] as Game)
      })
  }, [tournament?.id, currentGame?.id, currentGame?.status])

  // 大会終了時：最終戦の結果を未確認なら modal 表示
  useEffect(() => {
    if (!tournament || !currentGame) return
    if (tournament.status !== 'finished') return
    if (!userId) return

    const key = `omojan:result_seen:${tournament.id}:${currentGame.round_number}`
    if (typeof window !== 'undefined' && localStorage.getItem(key)) return

    const game = currentGame
    Promise.resolve().then(() => setPrevResultGame(game))
  }, [tournament, currentGame, userId])

  // showing_rematch を見ているユーザーは「再戦を認知済み」としてマーク
  useEffect(() => {
    if (!tournament || !currentGame) return
    if (currentGame.status !== 'showing_rematch') return
    if (typeof window !== 'undefined') {
      localStorage.setItem(`omojan:rematch_seen:${tournament.id}:round${currentGame.round_number}`, '1')
    }
  }, [tournament?.id, currentGame?.id, currentGame?.status])

  // 再戦ゲームに遷移したとき、未確認なら再戦モーダルを表示
  useEffect(() => {
    if (!tournament || !currentGame) return
    if (!currentGame.is_rematch || currentGame.status !== 'waiting_submission') return
    if (!userId) return

    const key = `omojan:rematch_seen:${tournament.id}:round${currentGame.round_number}`
    if (typeof window !== 'undefined' && localStorage.getItem(key)) return

    // 元の showing_rematch ゲームを取得して結果詳細を表示
    supabase
      .from('games')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('round_number', currentGame.round_number)
      .eq('status', 'showing_rematch')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setRematchNoticeGame(data[0] as Game)
        else setRematchNoticeGame(currentGame)
      })
  }, [tournament?.id, currentGame?.id, currentGame?.status, currentGame?.is_rematch, userId])

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

  const isExhibitionMode = tournament.tournament_type === 'exhibition'

  const stepInfo = (() => {
    if (tournament.status === 'waiting_users') return { label: '参加者募集中', bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-100' }
    if (tournament.status === 'creating_cards') return { label: '札作成中', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' }
    if (tournament.status === 'finished') return { label: '大会終了', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' }
    if (tournament.status === 'final_tiebreaker') return { label: '⚔️ 大会決戦中', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' }
    if (tournament.status === 'playing' && currentGame) {
      if (currentGame.status === 'waiting_submission') return { label: '作品投稿中', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' }
      if (currentGame.status === 'waiting_vote') return { label: '投票中', bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-100' }
      if (currentGame.status === 'waiting_tiebreaker_vote') return { label: '決選投票中', bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' }
      if (currentGame.status === 'waiting_button_mash') return { label: '連打決戦中', bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' }
      if (currentGame.status === 'showing_rematch') return { label: '再戦', bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' }
      return { label: '結果発表', bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-200' }
    }
    return { label: '', bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-100' }
  })()

  const userHasJoinedTournament = !!userId && participants.some((p) => p.id === userId)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white sticky top-0 z-10 border-b border-gray-200">
        <div className="px-4 py-2">
          <div className="relative flex justify-center items-center">
            <img src="/omojan_logo.png" alt="おもじゃん for 男根祭" className="h-10 w-auto" />
            {isExhibitionMode ? (
              <span className="absolute left-0 bottom-0 text-xs font-bold text-violet-600 bg-violet-50 border border-violet-300 px-2 py-0.5 rounded-full">
                🤖 EX{tournamentNumber ? `第${tournamentNumber}回` : ''}
              </span>
            ) : tournamentNumber && (
              <span className="absolute left-0 bottom-0 text-xs font-bold text-yellow-700 bg-yellow-50 border border-yellow-300 px-2 py-0.5 rounded-full">
                第{tournamentNumber}回大会
              </span>
            )}
            {tournament.status === 'playing' && currentGame && (
              <span className={`absolute right-0 bottom-0 text-xs font-bold px-2 py-0.5 rounded-full border ${
                currentGame.is_rematch
                  ? 'text-orange-600 bg-orange-50 border-orange-300'
                  : currentGame.round_number === tournament.game_count
                  ? 'text-red-600 bg-red-50 border-red-300'
                  : 'text-emerald-600 bg-emerald-50 border-emerald-200'
              }`}>
                {currentGame.is_rematch
                  ? `再戦 ${currentGame.round_number} / ${tournament.game_count}回戦`
                  : currentGame.round_number === tournament.game_count
                  ? '最終戦'
                  : `${currentGame.round_number} / ${tournament.game_count}回戦`}
              </span>
            )}
          </div>
        </div>
        <div className={`h-5 flex items-center justify-center ${stepInfo.bg}`}>
          <span className={`text-[10px] font-semibold tracking-wide ${stepInfo.text}`}>
            {stepInfo.label}
          </span>
        </div>
      </header>

      <div className="max-w-md mx-auto">
        {/* エキシビションバナー */}
        {isExhibitionMode && (
          <div className="mx-4 mt-4 mb-2 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <div>
              <p className="text-xs font-bold text-violet-700">エキシビションモード</p>
              <p className="text-[11px] text-violet-500 mt-0.5">AIがあなたの代わりに作品を作ります。内容を確認してボタンを押してください。</p>
            </div>
          </div>
        )}

        {/* ユーザー選択フェーズ（エキシビション含む） */}
        {tournament.status === 'waiting_users' && (
          userHasJoinedTournament && !tournament.skip_card_creation && tournament.cards_per_user > 0 && !isExhibitionMode
            ? (
              <CardCreation
                tournament={tournament}
                token={token}
                currentUserId={userId!}
                participants={participants}
                allUsers={allUsers}
                onSubmitted={async () => {
                  const res = await fetch(`/api/tournaments/${token}/advance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ triggering_user_id: userId }),
                  })
                  const data = await res.json()
                  if (data.advanced) await fetchState()
                  else await fetchState()
                }}
              />
            )
            : (
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
                  const res = await fetch(`/api/tournaments/${token}/advance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ triggering_user_id: uid }),
                  })
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
            )
        )}

        {/* 非参加者メッセージ（大会進行中に userId がない場合） */}
        {(tournament.status === 'creating_cards' || tournament.status === 'playing' || tournament.status === 'final_tiebreaker') && !userId && (
          <RejoinScreen participants={participants} onRejoin={saveUser} />
        )}

        {/* 札作成フェーズ */}
        {tournament.status === 'creating_cards' && userId && (
          <CardCreation
            tournament={tournament}
            token={token}
            currentUserId={userId}
            participants={participants}
            isExhibitionMode={isExhibitionMode}
            onSubmitted={async () => {
              const res = await fetch(`/api/tournaments/${token}/advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ triggering_user_id: userId }),
              })
              const data = await res.json()
              if (data.advanced) await fetchState()
              else await fetchState()
            }}
          />
        )}

        {/* ゲームプレイフェーズ */}
        {tournament.status === 'playing' && currentGame && userId && (
          <>
            {/* タブ（2回戦以降 or 再戦時 or 流局確認中） */}
            {(currentGame.round_number > 1 || currentGame.is_rematch || currentGame.status === 'showing_rematch') && (
              <div className="flex border-b border-gray-200 bg-white sticky top-[77px] z-10">
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
              <Archive tournamentId={tournament.id} participants={participants} impersonationMode={tournament.impersonation_mode} randomVoting={tournament.random_voting} />
            ) : currentGame.status === 'waiting_submission' ? (
              <>
                <GamePlay
                  tournament={{ ...tournament, impersonation_mode: tournament.random_voting ? currentGame.voting_mode === 'impersonation' : tournament.impersonation_mode }}
                  token={token}
                  game={currentGame}
                  currentUserId={userId ?? ''}
                  participants={participants}
                  isExhibitionMode={isExhibitionMode}
                  onSubmitted={async () => {
                    const res = await fetch(`/api/tournaments/${token}/advance`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ triggering_user_id: userId }),
                    })
                    const data = await res.json()
                    if (data.advanced) await fetchState()
                    else await fetchState()
                  }}
                />
              </>
            ) : currentGame.status === 'waiting_button_mash' ? (
              <ButtonMash
                token={token}
                game={currentGame}
                currentUserId={userId ?? ''}
                participants={participants}
                onCompleted={async () => {
                  const res = await fetch(`/api/tournaments/${token}/advance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ triggering_user_id: userId }),
                  })
                  const data = await res.json()
                  if (data.advanced) await fetchState()
                  else await fetchState()
                }}
              />
            ) : currentGame.status === 'waiting_vote' || currentGame.status === 'waiting_tiebreaker_vote' ? (
              <>
              <Voting
                tournament={{
                  ...tournament,
                  secret_voting: tournament.random_voting
                    ? currentGame.voting_mode === 'secret'
                    : tournament.secret_voting && (tournament.secret_round === null || tournament.secret_round === currentGame.round_number),
                  impersonation_mode: tournament.random_voting
                    ? currentGame.voting_mode === 'impersonation'
                    : tournament.impersonation_mode,
                }}
                token={token}
                game={currentGame}
                currentUserId={userId ?? ''}
                participants={participants}
                isExhibitionMode={isExhibitionMode}
                onVoted={async () => {
                  const res = await fetch(`/api/tournaments/${token}/advance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ triggering_user_id: userId }),
                  })
                  const data = await res.json()
                  if (data.advanced) await fetchState()
                  else await fetchState()
                }}
              />
              </>
            ) : (
              <Results
                tournament={{
                  ...tournament,
                  impersonation_mode: tournament.random_voting
                    ? currentGame.voting_mode === 'impersonation'
                    : tournament.impersonation_mode,
                }}
                token={token}
                game={currentGame}
                currentUserId={userId ?? ''}
                participants={participants}
                nextLabel={currentGame.status === 'showing_rematch' ? '再戦へ' : undefined}
                onNext={async () => {
                  localStorage.setItem(
                    `omojan:result_seen:${tournament.id}:${currentGame.round_number}`,
                    '1'
                  )
                  const res = await fetch(`/api/tournaments/${token}/advance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm_result: true }),
                  })
                  const data = await res.json()
                  if (data.advanced) {
                    await fetchState()
                    // 大会終了時にAI総評を非同期生成（ブロックしない）
                    if (data.newStatus === 'finished' || data.newStatus === 'final_tiebreaker') {
                      fetch('/api/ai/generate-comments', { method: 'POST' }).catch(() => {})
                    }
                  }
                }}
              />
            )}
          </>
        )}

        {/* 大会決戦フェーズ */}
        {tournament.status === 'final_tiebreaker' && currentGame && (
          userId ? (
            <ButtonMash
              token={token}
              game={currentGame}
              currentUserId={userId}
              participants={participants}
              duration={5000}
              forcedContestants={
                currentGame.voting_mode?.startsWith('final_tiebreaker:')
                  ? currentGame.voting_mode.replace('final_tiebreaker:', '').split(',').filter(Boolean)
                  : undefined
              }
              onCompleted={async () => {
                const res = await fetch(`/api/tournaments/${token}/advance`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ triggering_user_id: userId }),
                })
                const data = await res.json()
                if (data.advanced) {
                  await fetchState()
                  if (data.newStatus === 'finished') {
                    fetch('/api/ai/generate-comments', { method: 'POST' }).catch(() => {})
                  }
                } else {
                  await fetchState()
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
              <p className="text-4xl mb-4">⚔️</p>
              <p className="text-gray-700 font-medium">大会決戦が行われています</p>
              <p className="text-sm text-gray-400 mt-1">しばらくお待ちください</p>
            </div>
          )
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
        <p className="text-xs text-gray-300">v1.44.5</p>
      </footer>

      {/* 前戦結果モーダル（まだ結果を確認していないユーザー向け） */}
      {prevResultGame && userId && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 pt-8">
            <div className="bg-gray-50 rounded-2xl w-full max-w-md overflow-hidden">
              <Results
                tournament={{
                  ...tournament,
                  impersonation_mode: tournament.random_voting
                    ? prevResultGame.voting_mode === 'impersonation'
                    : tournament.impersonation_mode,
                }}
                token={token}
                game={prevResultGame}
                currentUserId={userId}
                participants={participants}
                nextLabel={prevResultGame.round_number >= tournament.game_count ? '確認して大会結果へ' : '確認して次へ進む'}
                onNext={async () => {
                  localStorage.setItem(
                    `omojan:result_seen:${tournament.id}:${prevResultGame.round_number}`,
                    '1'
                  )
                  setPrevResultGame(null)
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 再戦通知モーダル（showing_rematch を見ていなかったユーザー向け） */}
      {rematchNoticeGame && userId && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 pt-8">
            <div className="bg-gray-50 rounded-2xl w-full max-w-md overflow-hidden">
              <Results
                tournament={{
                  ...tournament,
                  impersonation_mode: tournament.random_voting
                    ? rematchNoticeGame.voting_mode === 'impersonation'
                    : tournament.impersonation_mode,
                }}
                token={token}
                game={rematchNoticeGame}
                currentUserId={userId}
                participants={participants}
                nextLabel="再戦へ"
                onNext={async () => {
                  localStorage.setItem(`omojan:rematch_seen:${tournament.id}:round${rematchNoticeGame.round_number}`, '1')
                  setRematchNoticeGame(null)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
