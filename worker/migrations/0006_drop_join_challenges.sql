-- Access OTP verifies identity before submit, so challenge staging is gone.
-- rate_limits and moderation_events stay; moderation_events.challenge_id remains nullable history.

DROP INDEX IF EXISTS idx_challenges_email;
DROP INDEX IF EXISTS idx_challenges_expires;
DROP TABLE IF EXISTS join_challenges;
