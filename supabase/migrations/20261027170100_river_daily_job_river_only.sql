-- river.daily_job without Mosaic ID's upkeep (preparing Mosaic ID to leave this database).
--
-- The previous migration, 20261027170000_identity_daily_job.sql, gave the identity schema its own
-- identity.daily_job() and pg_cron job (identity-daily), which purge identity.auth_requests and
-- release unverified addresses. This one redefines river.daily_job from its version in
-- 20261027120000_acting_tables.sql with those two steps, and their two keys in the summary,
-- removed. Nothing else changes. This migration touches the river schema only.

CREATE OR REPLACE FUNCTION river.daily_job(p_at timestamptz DEFAULT now()) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  ended_follows integer;
  kept_streams integer;
  deleted_items integer;
  deleted_follows integer;
  deleted_attempts integer := 0;
  deleted_previews integer;
  deleted_acting_attempts integer;
  lapsed_links integer;
  deleted_actions integer;
  deleted_links integer;
  restamped integer;
BEGIN
  -- Follows of ended streams move to Ended, in case a refresh stopped before doing it.
  UPDATE river.follows f
     SET ended_at = coalesce(s.ended_at, p_at)
    FROM river.streams s
   WHERE f.stream_id = s.id
     AND s.status = 'ended'
     AND f.ends_with_stream
     AND f.ended_at IS NULL;
  GET DIAGNOSTICS ended_follows = ROW_COUNT;

  -- Streams an account follows (the stream, or its whole space) keep their final result for good.
  UPDATE river.streams s
     SET keep_final_result = true
   WHERE NOT s.keep_final_result
     AND EXISTS (
       SELECT 1 FROM river.follows f
        WHERE f.rule = 'follow'
          AND f.space_id = s.space_id
          AND (f.stream_id = s.id OR f.stream_id IS NULL)
     );
  GET DIAGNOSTICS kept_streams = ROW_COUNT;

  -- Retention (spec 3.1): items older than 90 days, except final results of followed streams and
  -- sample items. read_state rows go with their items (ON DELETE CASCADE).
  DELETE FROM river.items i
   USING river.spaces sp
   WHERE sp.id = i.space_id
     AND sp.adapter <> 'sample'
     AND i.published_at < p_at - interval '90 days'
     AND NOT (
       i.is_final_result
       AND EXISTS (
         SELECT 1 FROM river.streams s
          WHERE s.space_id = i.space_id AND s.key = i.stream_key AND s.keep_final_result
       )
     );
  GET DIAGNOSTICS deleted_items = ROW_COUNT;

  -- Ended follows are cleared 90 days after they ended (spec F7).
  DELETE FROM river.follows WHERE ended_at < p_at - interval '90 days';
  GET DIAGNOSTICS deleted_follows = ROW_COUNT;

  -- Sign-in bookkeeping: River attempts older than an hour (they live 10 minutes; each sign-in
  -- start stores one, so they shouldn't pile up for a day).
  IF to_regclass('river.auth_attempts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM river.auth_attempts WHERE created_at < $1' USING p_at - interval '1 hour';
    GET DIAGNOSTICS deleted_attempts = ROW_COUNT;
  END IF;

  -- Acting (ADR-010). A preview is good for 15 minutes and was never sent.
  DELETE FROM river.member_actions WHERE status = 'previewed' AND created_at < p_at - interval '15 minutes';
  GET DIAGNOSTICS deleted_previews = ROW_COUNT;

  -- Linking, grant and step-up attempts live 10 minutes; they go after a day.
  DELETE FROM river.acting_attempts WHERE created_at < p_at - interval '1 day';
  GET DIAGNOSTICS deleted_acting_attempts = ROW_COUNT;

  -- A credential unused for 180 days is deleted (ADR-010 §6). This job makes no network calls,
  -- so it can't revoke it at the server; nobody holds the token any more, so what is left there
  -- is inert. The row stays, lapsed, for Your activity.
  UPDATE river.linked_accounts
     SET token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL,
         status = 'lapsed', revoked_at = p_at
   WHERE status = 'active'
     AND coalesce(last_used_at, linked_at) < p_at - interval '180 days';
  GET DIAGNOSTICS lapsed_links = ROW_COUNT;

  -- Your activity is kept a year (ADR-010 §7), and so is a link a year after it ended (its rows in
  -- Your activity keep their own target names).
  DELETE FROM river.member_actions WHERE created_at < p_at - interval '1 year';
  GET DIAGNOSTICS deleted_actions = ROW_COUNT;
  DELETE FROM river.linked_accounts WHERE status <> 'active' AND revoked_at < p_at - interval '1 year';
  GET DIAGNOSTICS deleted_links = ROW_COUNT;

  restamped := river.restamp_samples(p_at);

  RETURN jsonb_build_object(
    'ended_follows', ended_follows,
    'kept_streams', kept_streams,
    'deleted_items', deleted_items,
    'deleted_follows', deleted_follows,
    'deleted_auth_attempts', deleted_attempts,
    'deleted_previews', deleted_previews,
    'deleted_acting_attempts', deleted_acting_attempts,
    'lapsed_links', lapsed_links,
    'deleted_member_actions', deleted_actions,
    'deleted_linked_accounts', deleted_links,
    'restamped_samples', restamped
  );
END
$$;

REVOKE ALL ON FUNCTION river.daily_job(timestamptz) FROM PUBLIC;
