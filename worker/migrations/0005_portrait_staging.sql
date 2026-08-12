-- Forward-only: stage filtered portrait bytes on the join challenge until email verify.
-- Nothing durable (R2) is written before verification, so there are never orphaned objects.
-- portrait_blob holds raw WebP/PNG bytes; portrait_mime is 'image/webp' | 'image/png' | ''.

ALTER TABLE join_challenges ADD COLUMN portrait_blob BLOB;
ALTER TABLE join_challenges ADD COLUMN portrait_mime TEXT NOT NULL DEFAULT '';
