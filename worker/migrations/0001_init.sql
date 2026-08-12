-- Coalition directory + passwordless join flow.
-- Untrusted submissions never auto-publish (status stays pending_review until human publish).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY NOT NULL,
  email_hash TEXT NOT NULL,
  email_domain TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  -- NFKC + casefold + collapse whitespace for duplicate-name guards
  name_key TEXT NOT NULL,
  affiliation TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL,
  contribution TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '',
  statement TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  source TEXT NOT NULL CHECK (source IN ('canonical', 'community')),
  status TEXT NOT NULL CHECK (
    status IN ('pending_review', 'published', 'rejected', 'suspended')
  ),
  sort_index INTEGER NOT NULL DEFAULT 1000,
  moderation_score REAL,
  moderation_notes TEXT NOT NULL DEFAULT '',
  moderation_model TEXT NOT NULL DEFAULT '',
  moderation_recommendation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  verified_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_hash ON members(email_hash);
CREATE INDEX IF NOT EXISTS idx_members_status_source ON members(status, source);
CREATE INDEX IF NOT EXISTS idx_members_sector ON members(sector);
CREATE INDEX IF NOT EXISTS idx_members_sort ON members(sort_index, full_name);
CREATE INDEX IF NOT EXISTS idx_members_published_at ON members(published_at);
CREATE INDEX IF NOT EXISTS idx_members_name_key_published ON members(name_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_name_key_published_unique
  ON members(name_key) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS join_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  email_hash TEXT NOT NULL,
  email_domain TEXT NOT NULL DEFAULT '',
  -- Public-safe join fields only (no email, turnstile token, or honeypot).
  payload_json TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  magic_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_challenges_email ON join_challenges(email_hash);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON join_challenges(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject_hash, window_start)
);

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT,
  challenge_id TEXT,
  decision TEXT NOT NULL,
  score REAL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_member ON moderation_events(member_id);
