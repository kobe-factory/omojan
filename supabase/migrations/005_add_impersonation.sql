-- なりすましモード追加
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS impersonation_mode BOOLEAN DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS impersonated_user_id UUID REFERENCES users(id);
