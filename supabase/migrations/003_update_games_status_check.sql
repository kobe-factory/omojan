-- games.status の CHECK 制約に waiting_tiebreaker_vote / showing_rematch を追加
-- （決選投票・再戦機能追加時に漏れていた対応）
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE games ADD CONSTRAINT games_status_check
  CHECK (status IN (
    'waiting_submission',
    'waiting_vote',
    'waiting_tiebreaker_vote',
    'showing_result',
    'showing_rematch',
    'finished'
  ));
