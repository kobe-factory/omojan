// ===================================================
// おもじゃん ゲーム設定
// POC検証時はここの値を変更してください
// ===================================================

// 参加ユーザー名（DBの初期データと一致させること）
export const USERS = ['はじむ', 'スラパン', 'こんべ', 'かねおか', 'カズさん'] as const

export type TournamentMode = 'solo' | 'test' | 'production'

export interface GamePreset {
  label: string
  description: string
  mode: TournamentMode         // データ区分（リセット対象の判定に使用）
  required_players: number     // ゲーム開始に必要な参加人数
  game_count: number           // 1大会のゲーム数（回戦数）
  cards_per_user: number       // 各ユーザーが作成する札の枚数（下ネタ含む合計）
  hand_cards_per_player: number // 各プレイヤーに配られる手札の枚数
  dirty_cards_per_user: number  // cards_per_user のうち下ネタ専用枠の枚数
}

export const GAME_PRESETS: GamePreset[] = [
  {
    label: 'ソロテスト',
    description: 'こんべ 1名',
    mode: 'solo',
    required_players: 1,
    game_count: 3,
    cards_per_user: 10,
    hand_cards_per_player: 5,
    dirty_cards_per_user: 1,
  },
  {
    label: '2名テスト',
    description: 'こんべ・カズさん 2名',
    mode: 'test',
    required_players: 2,
    game_count: 3,
    cards_per_user: 10,
    hand_cards_per_player: 5,
    dirty_cards_per_user: 1,
  },
  {
    label: '本番',
    description: '5名全員・フルゲーム',
    mode: 'production',
    required_players: 5,
    game_count: 5,
    cards_per_user: 12,
    hand_cards_per_player: 10,
    dirty_cards_per_user: 2,
  },
]

// デフォルトプリセット（adminページの初期選択）
export const DEFAULT_PRESET = GAME_PRESETS[2]
