'use client'

import { useState, useEffect, useCallback } from 'react'
import { GAME_PRESETS, DEFAULT_PRESET, type GamePreset } from '@/config/game'
import { supabase } from '@/lib/supabase'

interface TournamentRow {
  id: string
  token: string
  mode: string
  status: string
  created_at: string
  productionNumber?: number
}

const STATUS_LABEL: Record<string, string> = {
  waiting_users: 'ユーザー選択中',
  creating_cards: '札作成中',
  playing: 'ゲーム中',
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

  const fetchTournaments = useCallback(async () => {
    setListLoading(true)
    const { data } = await supabase
      .from('tournaments')
      .select('id, token, mode, status, created_at')
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

    const mapped = rows.map((t) => ({
      ...t,
      productionNumber: productionNumberMap[t.id],
    }))
    setTournaments(mapped)

    const active = mapped.find(
      (t) => t.mode === 'production' && ['waiting_users', 'creating_cards', 'playing'].includes(t.status)
    ) ?? null
    setActiveProductionTournament(active)

    setListLoading(false)
  }, [])

  useEffect(() => {
    fetchTournaments()
  }, [fetchTournaments])

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
          game_count: selectedPreset.game_count,
          cards_per_user: selectedPreset.cards_per_user,
          hand_cards_per_player: selectedPreset.hand_cards_per_player,
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

        {activeProductionTournament && selectedPreset.mode === 'production' && (
          <p className="text-xs text-red-400 text-center mb-3">
            本番大会が進行中のため、新たに発行できません
          </p>
        )}
        <button
          onClick={handleCreate}
          disabled={loading || (selectedPreset.mode === 'production' && !!activeProductionTournament)}
          className="w-full py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '発行中...' : '大会URLを発行する'}
        </button>

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
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
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
      </div>
    </div>
  )
}
