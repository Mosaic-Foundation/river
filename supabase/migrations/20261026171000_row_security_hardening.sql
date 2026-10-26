-- Security review of 3a86e8f, item 7: row-level security hardening (DECISIONS.md, 2026-10-26).
--
-- 1. river.accounts: the one FOR ALL policy let an UPDATE with no account in context (a
--    forInstance() transaction) reach every account of the instance, because the USING clause
--    allowed current_account_id() IS NULL so the hostname and seed paths could read. Reads and
--    inserts keep that clause; UPDATE now needs an account in context and touches only that row.
--    No code updates accounts today, so nothing changes for the app.
-- 2. river.spaces and river.streams are shared rows any instance transaction may write. UPDATE is
--    narrowed from every column to the columns the refresh and the follow box write
--    (src/river/feed/store.ts, src/river/feed/withdrawn.ts, src/river/following/service.ts).
--    Identity columns (adapter, canonical_url, feed_url, actor_id, network, category, home_url,
--    space_id, key) can no longer be rewritten by river_app.
--
-- Idempotent: policies are dropped if present and re-created; grants are revoked, then granted.

-- 1. accounts ----------------------------------------------------------------------------------
DROP POLICY IF EXISTS accounts_isolation ON river.accounts;
DROP POLICY IF EXISTS accounts_read ON river.accounts;
DROP POLICY IF EXISTS accounts_insert ON river.accounts;
DROP POLICY IF EXISTS accounts_update ON river.accounts;

CREATE POLICY accounts_read ON river.accounts FOR SELECT TO river_app
  USING (
    instance_id = (SELECT river.current_instance_id())
    AND ((SELECT river.current_account_id()) IS NULL OR id = (SELECT river.current_account_id()))
  );

CREATE POLICY accounts_insert ON river.accounts FOR INSERT TO river_app
  WITH CHECK (
    instance_id = (SELECT river.current_instance_id())
    AND ((SELECT river.current_account_id()) IS NULL OR id = (SELECT river.current_account_id()))
  );

CREATE POLICY accounts_update ON river.accounts FOR UPDATE TO river_app
  USING (
    instance_id = (SELECT river.current_instance_id())
    AND (SELECT river.current_account_id()) IS NOT NULL
    AND id = (SELECT river.current_account_id())
  )
  WITH CHECK (
    instance_id = (SELECT river.current_instance_id())
    AND (SELECT river.current_account_id()) IS NOT NULL
    AND id = (SELECT river.current_account_id())
  );

-- 2. spaces and streams: UPDATE on the columns the code writes ---------------------------------
REVOKE UPDATE ON river.spaces FROM river_app;
GRANT UPDATE (etag, etag_url, newest_item_at, manifest, name, icon_url, fetch_status, last_error,
              error_count, fetch_lock_until, last_fetched_at)
  ON river.spaces TO river_app;

REVOKE UPDATE ON river.streams FROM river_app;
GRANT UPDATE (title, status, ended_at, last_checked_at) ON river.streams TO river_app;
