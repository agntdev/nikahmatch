-- Nikaḥ moderation rollout. The toolkit's Redis/DO session adapter applies the
-- same defaults for existing JSON records when they are read.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS publication_action TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT NOT NULL,
  target_id BIGINT,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS moderation_audit_log_created_at_idx ON moderation_audit_log (created_at DESC);
