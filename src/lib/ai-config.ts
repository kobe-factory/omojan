// AIモデル設定
// 環境変数で切り替え可能。未設定時はHaiku 4.5（コスト重視のデフォルト）
//
// 設定例（.env.local）:
//   AI_MODEL_COMMENTS=claude-haiku-4-5-20251001   （デフォルト）
//   AI_MODEL_COMMENTS=claude-sonnet-4-6            （高品質）
//   AI_MODEL_PLAYER=claude-sonnet-4-6              （デフォルト）
//   AI_MODEL_PLAYER=claude-haiku-4-5-20251001      （低コスト）

export const AI_MODEL_COMMENTS: string =
  process.env.AI_MODEL_COMMENTS ?? 'claude-haiku-4-5-20251001'

export const AI_MODEL_PLAYER: string =
  process.env.AI_MODEL_PLAYER ?? 'claude-sonnet-4-6'
