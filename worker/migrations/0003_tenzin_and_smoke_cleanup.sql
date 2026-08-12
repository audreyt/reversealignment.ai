-- Remove known local smoke residue and publish Tenzin Yangtso as the 25th directory person.
-- Targeted: does not wipe unrelated member rows.

-- Exact polluted local smoke row (non-isolated earlier run).
DELETE FROM members
WHERE id = 'mbr_fd512ea5db8567c1fbcbc531d6c14367';

-- Any remaining Smoke Tester community residue from lifecycle demos.
DELETE FROM members
WHERE full_name = 'Smoke Tester'
  AND source = 'community';

DELETE FROM members
WHERE email_hash LIKE 'seed:smoke%'
   OR (email_domain = 'example.com' AND full_name = 'Smoke Tester');

-- Durable Tenzin entry: monogram (NULL image_key), public role exact.
INSERT INTO members (
  id, email_hash, email_domain, full_name, name_key, affiliation, role, sector, contribution,
  links, statement, image_key, source, status, sort_index,
  moderation_score, moderation_notes, moderation_model, moderation_recommendation,
  created_at, updated_at, published_at, verified_at
) VALUES (
  'canonical:person-tenzin-yangtso',
  'seed:tenzin-yangtso',
  'canonical.local',
  'Tenzin Yangtso',
  'tenzin yangtso',
  'Civic.AI',
  'Researcher, Civic.AI',
  'Research',
  '',
  '',
  '',
  NULL,
  'canonical',
  'published',
  24,
  1.0,
  'seed',
  'seed',
  'allow',
  '2026-07-24T00:00:00.000Z',
  '2026-07-24T00:00:00.000Z',
  '2026-07-24T00:00:00.000Z',
  '2026-07-24T00:00:00.000Z'
)
ON CONFLICT(id) DO UPDATE SET
  email_hash = excluded.email_hash,
  email_domain = excluded.email_domain,
  full_name = excluded.full_name,
  name_key = excluded.name_key,
  affiliation = excluded.affiliation,
  role = excluded.role,
  sector = excluded.sector,
  image_key = NULL,
  source = 'canonical',
  status = 'published',
  sort_index = excluded.sort_index,
  moderation_score = excluded.moderation_score,
  moderation_notes = excluded.moderation_notes,
  moderation_model = excluded.moderation_model,
  moderation_recommendation = excluded.moderation_recommendation,
  updated_at = excluded.updated_at,
  published_at = COALESCE(members.published_at, excluded.published_at),
  verified_at = COALESCE(members.verified_at, excluded.verified_at);
