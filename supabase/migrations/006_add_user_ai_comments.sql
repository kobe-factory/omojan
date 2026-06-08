-- AI生成の個人総評テーブル
CREATE TABLE IF NOT EXISTS user_ai_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) NOT NULL,
  overall_comment text,
  last_tournament_comment text,
  last_tournament_id uuid REFERENCES tournaments(id),
  tournament_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE user_ai_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for all" ON user_ai_comments FOR SELECT USING (true);
CREATE POLICY "Allow all for service role" ON user_ai_comments USING (true) WITH CHECK (true);
