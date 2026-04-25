-- おもじゃん DBスキーマ
-- Supabaseのダッシュボード > SQL Editor で実行してください

-- 大会テーブル
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  required_players INT DEFAULT 5,        -- ゲーム開始に必要な参加人数
  game_count INT DEFAULT 5,              -- 1大会のゲーム数
  cards_per_user INT DEFAULT 20,         -- 各ユーザーが作成する札の枚数
  hand_cards_per_player INT DEFAULT 10,  -- 各プレイヤーに配られる手札の枚数
  status TEXT DEFAULT 'waiting_users' CHECK (status IN ('waiting_users', 'creating_cards', 'playing', 'finished')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ユーザーマスタ（固定5名）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

-- 大会参加者
CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, user_id)
);

-- 札（全ユーザーが作成したカード）
CREATE TABLE IF NOT EXISTS cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  creator_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 手札配布
CREATE TABLE IF NOT EXISTS player_hands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  is_used BOOLEAN DEFAULT false,
  UNIQUE(tournament_id, user_id, card_id)
);

-- ゲーム（各ラウンド）
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  status TEXT DEFAULT 'waiting_submission' CHECK (status IN ('waiting_submission', 'waiting_vote', 'showing_result', 'finished')),
  topic_card_id UUID REFERENCES cards(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 作品投稿
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  hand_card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  position TEXT NOT NULL CHECK (position IN ('before', 'after')),
  preamble TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, user_id)
);

-- 投票
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  voter_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, voter_user_id)
);

-- Row Level Security を有効化（全テーブル）
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- RLSポリシー（全員が読み書き可能 - POCのためシンプルに）
CREATE POLICY "Allow all" ON tournaments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON tournament_participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON cards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON player_hands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON games FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON submissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON votes FOR ALL USING (true) WITH CHECK (true);

-- 初期データ: ユーザー5名を挿入
INSERT INTO users (name) VALUES
  ('はじむ'),
  ('スラパン'),
  ('こんべ'),
  ('かねおか'),
  ('カズさん')
ON CONFLICT (name) DO NOTHING;
