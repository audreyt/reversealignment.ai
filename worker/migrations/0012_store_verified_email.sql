-- Retain the Access-verified email privately for outreach and moderation.
-- Public member queries enumerate explicit columns and never expose this field.
-- Existing rows remain blank until their next Access-authenticated join, where
-- the Worker self-heals the address from the verified JWT identity.

ALTER TABLE members ADD COLUMN email TEXT NOT NULL DEFAULT '';
