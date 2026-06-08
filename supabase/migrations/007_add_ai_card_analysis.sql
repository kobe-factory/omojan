ALTER TABLE user_ai_comments
  ADD COLUMN IF NOT EXISTS card_analysis_comment text,
  ADD COLUMN IF NOT EXISTS nickname text;
