-- Session revocation (DECISIONS.md, 2026-10-26; the follow-up the security review of 3a86e8f left
-- for its own PR).
--
-- Every River session cookie carries its account's session epoch, and a cookie whose epoch isn't
-- the account's current one reads as a visitor. "Sign out everywhere" raises the epoch by one,
-- which ends every session issued before it, on every device. Cookies from before this change carry
-- no epoch and are refused outright (Adam, 2026-10-26), so every member signs in once.
--
-- river_app already holds UPDATE on river.accounts, and the accounts_update policy limits it to
-- the account in context (20261026171000_row_security_hardening.sql). The code reads every
-- account as epoch 1 until this column exists, which is its default, so sessions issued between
-- the code's deploy and this migration stay good.
--
-- Idempotent.
ALTER TABLE river.accounts ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_session_epoch_positive') THEN
    ALTER TABLE river.accounts ADD CONSTRAINT accounts_session_epoch_positive CHECK (session_epoch >= 1);
  END IF;
END $$;
