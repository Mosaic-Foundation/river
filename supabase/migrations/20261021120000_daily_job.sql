-- M5: the daily job (spec 3.1 "Retention", 4.5) and what the refresh needs beyond M1's grants.
--
-- 1. streams.keep_final_result. Retention keeps "is_final_result items of streams any account
--    followed". A stream-only follow is deleted 90 days after its stream ends, about when its
--    final result turns 90 days old, so "followed" has to outlive the follow row. The daily job
--    sets this flag on every stream an account follows (the stream itself or its whole space)
--    before it runs retention, and never clears it. Additive; nothing else reads it.
--
-- 2. river.mark_stream_follows_ended(stream_id). The refresh runs inside forInstance() with no
--    account, and follows are visible only to their own account, so it can't set ended_at on
--    every account's follows when a stream ends (spec 4.2 "Stream end"). This SECURITY DEFINER
--    function does that one thing: for a stream whose status is already 'ended', it copies the
--    stream's ended_at onto follows with ends_with_stream = true that have none yet. It takes
--    no other input and changes no other column. river_app may execute it.
--
-- 3. river.restamp_samples(at) and river.daily_job(at). SQL only, no network. The job runs as
--    postgres (pg_cron schedules as the role that called cron.schedule), which bypasses
--    row-level security, so retention can delete across instances; river_app has no DELETE on
--    items and can't execute either function. Both take the time as a parameter (default now())
--    so tests can run them with the clock moved ahead.
--
-- 4. pg_cron: one job, river-daily, at 04:17 UTC.

ALTER TABLE river.streams ADD COLUMN keep_final_result boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------
-- Follows end with their stream
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION river.mark_stream_follows_ended(p_stream_id uuid) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE river.follows f
     SET ended_at = coalesce(s.ended_at, now())
    FROM river.streams s
   WHERE s.id = p_stream_id
     AND s.status = 'ended'
     AND f.stream_id = s.id
     AND f.ends_with_stream
     AND f.ended_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$$;

REVOKE ALL ON FUNCTION river.mark_stream_follows_ended(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION river.mark_stream_follows_ended(uuid) TO river_app;

-- ---------------------------------------------------------------------------------------------
-- Sample dates (spec 4.4): each sample item keeps its age in raw.sample.age (an interval, e.g.
-- '3 hours') and, for an event, how far ahead it starts in raw.sample.startsIn. Re-stamping sets
-- published_at = at - age and raw.startTime = at + startsIn, so samples always look recent.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION river.restamp_samples(p_at timestamptz DEFAULT now()) RETURNS integer
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE river.items i
     SET published_at = p_at - (i.raw -> 'sample' ->> 'age')::interval,
         fetched_at = p_at,
         raw = CASE
                 WHEN i.raw -> 'sample' ? 'startsIn' THEN
                   jsonb_set(i.raw, '{startTime}',
                             to_jsonb(p_at + (i.raw -> 'sample' ->> 'startsIn')::interval))
                 ELSE i.raw
               END
    FROM river.spaces s
   WHERE s.id = i.space_id
     AND s.adapter = 'sample'
     AND i.raw -> 'sample' ? 'age';
  GET DIAGNOSTICS changed = ROW_COUNT;

  UPDATE river.spaces s
     SET newest_item_at = (SELECT max(i.published_at) FROM river.items i WHERE i.space_id = s.id),
         last_fetched_at = p_at,
         fetch_status = 'ok'
   WHERE s.adapter = 'sample';
  RETURN changed;
END
$$;

REVOKE ALL ON FUNCTION river.restamp_samples(timestamptz) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- The daily job
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION river.daily_job(p_at timestamptz DEFAULT now()) RETURNS jsonb
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

  -- Sign-in bookkeeping older than a day. The tables arrive in M7 (identity.auth_requests) and
  -- M8 (river.auth_attempts); until then there is nothing to delete.
  IF to_regclass('river.auth_attempts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM river.auth_attempts WHERE created_at < $1' USING p_at - interval '1 day';
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

-- ---------------------------------------------------------------------------------------------
-- pg_cron (available on Supabase, hosted and local). cron.schedule() with a job name replaces
-- an existing job of that name, so re-running this is harmless.
-- ---------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule('river-daily', '17 4 * * *', 'SELECT river.daily_job()');
