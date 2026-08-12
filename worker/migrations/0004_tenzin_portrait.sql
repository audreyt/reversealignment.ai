-- Forward-only: attach first-party portrait asset to durable Tenzin entry.
-- Does not alter 0003 semantics; role/affiliation/status remain unchanged.

UPDATE members
SET
  image_key = 'person-tenzin-yangtso',
  updated_at = '2026-07-24T12:00:00.000Z'
WHERE id = 'canonical:person-tenzin-yangtso'
  AND full_name = 'Tenzin Yangtso'
  AND role = 'Researcher, Civic.AI'
  AND source = 'canonical';
