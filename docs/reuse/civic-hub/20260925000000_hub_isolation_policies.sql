-- Phase 3, step 1: forced row-level security keyed on the caller's hub.
--
-- Until now the code was the only thing between one hub and another's rows:
-- forHub() adds the hub filter and stamp, the hostname resolver picks the hub,
-- the composite (hub_id, x_id) keys refuse a cross-hub reference. Every table
-- had RLS enabled with no policy (deny-all), which the app never met because
-- it connects as the service role, which bypasses RLS. This migration writes
-- the policy that the Phase 3 minted token runs under, so the database refuses
-- a cross-hub read or write on its own, whatever the code does.
--
-- ONE TEMPLATE. _civic_apply_hub_policy(table) is the only place the policy is
-- written. It enables and FORCEs row-level security and (re)creates a single
-- policy, hub_isolation:
--
--   FOR ALL TO authenticated
--   USING      (hub_id = (SELECT current_hub_id()))
--   WITH CHECK (hub_id = (SELECT current_hub_id()))
--
-- FOR ALL covers select, insert, update and delete with the same key, which is
-- what transition_process and cast_vote need: they are SECURITY INVOKER, so
-- under a hub token their inserts into processes, vote_records,
-- vote_participation, active_vote_keys and events, their updates, and the
-- SELECT … FOR UPDATE lock on processes (which needs the row to pass the
-- UPDATE policy too) are all checked against the caller's hub. A table added
-- later calls the same function in its own migration; the catalog test
-- (tests/api/rlsCatalog.test.ts) fails until it does.
--
-- current_hub_id() is the one function every policy calls (defined in
-- 20260924070000, used by the storage policies; not redefined here). A token
-- without a hub_id claim makes it null, and null matches no row. `(SELECT …)`
-- makes it an initplan: evaluated once per statement, not once per row.
--
-- WHO IS BOUND. `authenticated` — the role of the minted hub token. The
-- service role and the owner (`postgres`) have BYPASSRLS, so the control
-- plane, operator scripts and migrations are unaffected, as is the app while
-- CIVIC_HUB_MINTED_TOKEN is off. `anon` gets no policy: default deny, as
-- before.
--
-- BALLOT SECRECY is exactly as the July 2026 audit left it. The policy reads
-- hub_id and nothing else: no policy consults a ballot, a choice, a receipt or
-- a participation row to decide anything, and no table gains a column or a
-- link.
--
-- FORCE is added on the ten tables that had RLS enabled but not forced:
-- deliberation_drafts, hub_settings, project_comments, project_drafts,
-- project_sentiments, project_updates, projects, proposal_drafts,
-- vote_drafts, waitlist. (The template forces every table; on the other
-- twenty it is a no-op.)
--
-- sessions gets its hub-leading index: it had (token, hub_id) but none that
-- starts with hub_id, and the policy is an equality filter on hub_id.
--
-- Additive: one index, one helper function, thirty policies. `hubs` has no
-- hub_id and keeps its deny-all RLS; only the service-role registry reads it.
-- PORTABLE: on plain Postgres (no `authenticated` role) RLS is still enabled
-- and forced, and the policies are skipped with a NOTICE.

CREATE INDEX IF NOT EXISTS sessions_hub_id_idx ON public.sessions (hub_id);

CREATE OR REPLACE FUNCTION public._civic_apply_hub_policy(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = p_table AND attname = 'hub_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '%: no hub_id column; a hub policy cannot key on it', p_table;
  END IF;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE '%: no authenticated role here; RLS forced, policy skipped', p_table;
    RETURN;
  END IF;

  EXECUTE format('DROP POLICY IF EXISTS hub_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY hub_isolation ON %s AS PERMISSIVE FOR ALL TO authenticated '
    'USING (hub_id = (SELECT public.current_hub_id())) '
    'WITH CHECK (hub_id = (SELECT public.current_hub_id()))',
    p_table
  );
END;
$$;

COMMENT ON FUNCTION public._civic_apply_hub_policy(regclass) IS
  'The one template for tenant isolation: enable + force RLS and create the hub_isolation policy keyed on current_hub_id(). Every table with hub_id calls it.';

-- Migration tooling only; no role the app uses can call it.
REVOKE ALL ON FUNCTION public._civic_apply_hub_policy(regclass) FROM PUBLIC;

-- Every base table in public that carries hub_id: thirty today. Driven by the
-- catalog rather than a list so that nothing carrying hub_id is missed here;
-- the catalog test is what catches a table added after this migration.
DO $$
DECLARE
  t regclass;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'hub_id' AND NOT a.attisdropped
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    PERFORM public._civic_apply_hub_policy(t);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'hub_isolation: % tables', n;
END $$;
