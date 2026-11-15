-- Mosaic ID's own daily job (preparing Mosaic ID to leave this repo and this database).
--
-- Until now river.daily_job also purged identity.auth_requests and released unverified
-- addresses in identity.people. Mosaic ID will move to its own repository and later its own
-- Supabase project, where no river schema exists, so its upkeep is its own function and its own
-- pg_cron job. This migration touches the identity schema only; the next one
-- (20261027170100_river_daily_job_river_only.sql) takes the two steps out of river.daily_job.
--
-- identity.daily_job(at) does what river.daily_job did for identity, unchanged, as of the version
-- in 20261027120000_acting_tables.sql:
--   1. auth_requests a day after they expired are deleted (they live 10 minutes).
--   2. A sign-up's address still unverified 24 hours on is released: it was never reserved, and
--      now the Mosaic ID stops naming it (it keeps its DID and passkeys, and may add one later).
-- SQL only, no network. It runs as postgres (pg_cron schedules as the role that called
-- cron.schedule), which bypasses row-level security; identity_app can't execute it. The time is a
-- parameter (default now()) so tests can run it with the clock moved ahead.
--
-- pg_cron: identity-daily at 04:23 UTC, six minutes after river-daily, so the two never overlap
-- by schedule. cron.schedule() with a job name replaces a job of that name, so re-running is
-- harmless. Between the two migrations of this PR both jobs would purge the same rows; deleting a
-- row already deleted, or nulling an address already null, changes nothing.

CREATE OR REPLACE FUNCTION identity.daily_job(p_at timestamptz DEFAULT now()) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  deleted_requests integer;
  released_addresses integer;
BEGIN
  DELETE FROM identity.auth_requests WHERE expires_at < p_at - interval '1 day';
  GET DIAGNOSTICS deleted_requests = ROW_COUNT;

  UPDATE identity.people SET email = NULL
   WHERE email IS NOT NULL AND email_verified_at IS NULL AND created_at < p_at - interval '24 hours';
  GET DIAGNOSTICS released_addresses = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_auth_requests', deleted_requests,
    'released_addresses', released_addresses
  );
END
$$;

REVOKE ALL ON FUNCTION identity.daily_job(timestamptz) FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule('identity-daily', '23 4 * * *', 'SELECT identity.daily_job()');
