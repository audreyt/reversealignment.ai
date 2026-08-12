-- Non-directory join intents (e.g. "Stay informed") must not sit in the
-- human directory-moderation queue. Add status=updates_only and reclassify
-- existing pending rows whose contribution is not a public endorsement.
--
-- SQLite cannot ALTER a table-level CHECK, so rebuild members and recreate
-- every index, including the partial unique on published name_key.

PRAGMA foreign_keys = OFF;

CREATE TABLE members_new (
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
    status IN ('pending_review', 'updates_only', 'published', 'rejected', 'suspended')
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

INSERT INTO members_new (
  id, email_hash, email_domain, full_name, name_key, affiliation, role, sector,
  contribution, links, statement, image_key, source, status, sort_index,
  moderation_score, moderation_notes, moderation_model, moderation_recommendation,
  created_at, updated_at, published_at, verified_at
)
SELECT
  id, email_hash, email_domain, full_name, name_key, affiliation, role, sector,
  contribution, links, statement, image_key, source,
  CASE
    WHEN status = 'pending_review'
      AND contribution NOT IN (
        -- Canonical English directory endorsements
        'Lend your name to the statement',
        'All of the above',
        -- Localized labels already stored from pre-value/label forms
        '連署這份聲明',
        '以上皆是',
        '声明に名前を連ねる',
        'すべて',
        'Prestar mi nombre a la declaración',
        'Todo lo anterior',
        'Emprestar meu nome à declaração',
        'Tudo acima'
      )
    THEN 'updates_only'
    ELSE status
  END,
  sort_index,
  moderation_score, moderation_notes, moderation_model, moderation_recommendation,
  created_at, updated_at, published_at, verified_at
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_hash ON members(email_hash);
CREATE INDEX IF NOT EXISTS idx_members_status_source ON members(status, source);
CREATE INDEX IF NOT EXISTS idx_members_sector ON members(sector);
CREATE INDEX IF NOT EXISTS idx_members_sort ON members(sort_index, full_name);
CREATE INDEX IF NOT EXISTS idx_members_published_at ON members(published_at);
CREATE INDEX IF NOT EXISTS idx_members_name_key_published ON members(name_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_name_key_published_unique
  ON members(name_key) WHERE status = 'published';

PRAGMA foreign_keys = ON;
