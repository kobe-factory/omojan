-- シークレットモードを大会全体ではなく1回戦のみに変更
-- secret_round: シークレットになる回戦番号（NULL = シークレットなし）
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS secret_round INT;
