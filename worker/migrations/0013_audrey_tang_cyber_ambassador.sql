-- Align the canonical Audrey Tang role with the public catalog (Cyber Ambassador).
UPDATE members
SET role = 'Cyber Ambassador, Taiwan',
    updated_at = '2026-08-13T00:00:00.000Z'
WHERE id = 'canonical:person-audrey-tang';
