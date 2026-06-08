ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS ai_comment text;
