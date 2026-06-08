-- games.status の CHECK 制約に waiting_tiebreaker_vote / showing_rematch / waiting_button_mash を追加
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE games ADD CONSTRAINT games_status_check
  CHECK (status IN (
    'waiting_submission',
    'waiting_vote',
    'waiting_tiebreaker_vote',
    'waiting_button_mash',
    'showing_result',
    'showing_rematch',
    'finished'
  ));
