-- Security review of 3a86e8f, item 4: the daily job deletes river.auth_attempts older than an
-- hour instead of a day. Each GET /api/auth/signin stores one row, and an attempt is good for 10
-- minutes, so a day's worth only kept spent rows around. The function is otherwise unchanged from
-- 20261021120000_daily_job.sql; the pg_cron job (river-daily) calls it by name and stays as it is.
-- CREATE OR REPLACE keeps the owner and the REVOKE; re-running this is harmless.

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
  deleted_requests integer := 0;
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
  -- start stores one, so they shouldn't pile up for a day), identity requests a day after expiry.
  IF to_regclass('river.auth_attempts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM river.auth_attempts WHERE created_at < $1' USING p_at - interval '1 hour';
    GET DIAGNOSTICS deleted_attempts = ROW_COUNT;
  END IF;
  IF to_regclass('identity.auth_requests') IS NOT NULL THEN
    EXECUTE 'DELETE FROM identity.auth_requests WHERE expires_at < $1' USING p_at - interval '1 day';
    GET DIAGNOSTICS deleted_requests = ROW_COUNT;
  END IF;

  restamped := river.restamp_samples(p_at);

  RETURN jsonb_build_object(
    'ended_follows', ended_follows,
    'kept_streams', kept_streams,
    'deleted_items', deleted_items,
    'deleted_follows', deleted_follows,
    'deleted_auth_attempts', deleted_attempts,
    'deleted_auth_requests', deleted_requests,
    'restamped_samples', restamped
  );
END
$$;

REVOKE ALL ON FUNCTION river.daily_job(timestamptz) FROM PUBLIC;
