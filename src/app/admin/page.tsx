'use client'

import { useState } from 'react'
import { GAME_PRESETS, DEFAULT_PRESET, type GamePreset } from '@/config/game'

export default function AdminPage() {
  const [selectedPreset, setSelectedPreset] = useState<GamePreset>(DEFAULT_PRESET)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

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

  async function handleReset() {
    const confirmed = window.confirm('ソロテスト・2名テストのデータを削除します。\n本番データは削除されません。\n\n本当にリセットしますか？')
    if (!confirmed) return

    setResetting(true)
    setResetDone(false)
    try {
      const res = await fetch('/api/admin/reset', { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setResetDone(true)
        setGeneratedUrl(null)
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
        <p className="text-sm text-gray-500 mb-8">大会URLを発行します</p>

        <p className="text-sm font-medium text-gray-700 mb-3">モードを選択</p>
        <div className="space-y-3 mb-8">
          {GAME_PRESETS.map((preset) => {
            const isSelected = selectedPreset.label === preset.label
            return (
              <button
                key={preset.label}
                onClick={() => {
                  setSelectedPreset(preset)
                  setGeneratedUrl(null)
                }}
                className={`w-full text-left rounded-xl p-4 border-2 transition-all ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-gray-200 bg-white hover:border-emerald-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-bold text-base ${isSelected ? 'text-emerald-600' : 'text-gray-700'}`}>
                    {preset.label}
                  </span>
                  {isSelected && <span className="text-emerald-500 text-sm">✓</span>}
                </div>
                <p className="text-sm text-gray-500 mb-2">{preset.description}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
                  <span>参加人数：{preset.required_players}名</span>
                  <span>回戦数：{preset.game_count}回</span>
                  <span>札作成枚数：{preset.cards_per_user}枚/人</span>
                  <span>配布手札：{preset.hand_cards_per_player}枚/人</span>
                </div>
              </button>
            )
          })}
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
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
            <p className="text-center text-xs text-green-600 mt-2">リセット完了しました</p>
          )}
          <p className="text-xs text-gray-400 mt-2 text-center">
            ソロ・2名テストのみ削除。本番・ユーザーデータは保持されます
          </p>
        </div>
      </div>
    </div>
  )
}
