-- The identity host's account page (HANDOFF, 2026-10-26): a Mosaic ID shows its recovery address
-- and its passkeys after a fresh passkey check, as changing the address does. That check is one
-- auth_requests row, whose purpose names the ceremony; this adds the purpose 'account'.
--
-- Until this lands, the page's "Show my account" answers 503 (the insert fails the old CHECK);
-- nothing else changes. Merge after 20261026201500_session_epoch.sql's PR, whose migration sorts
-- before this one.
--
-- Idempotent: the constraint is dropped if present and re-created.
ALTER TABLE identity.auth_requests DROP CONSTRAINT IF EXISTS auth_requests_purpose_check;
ALTER TABLE identity.auth_requests ADD CONSTRAINT auth_requests_purpose_check
  CHECK (purpose IN ('authorize', 'recover', 'change_email', 'account'));
