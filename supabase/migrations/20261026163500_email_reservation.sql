-- Security review of 3a86e8f, item 5: Mosaic ID email reservation (DECISIONS.md, 2026-10-26).
--
-- Before: identity.email_in_use counted unverified addresses, and people.email was UNIQUE. Anyone
-- could sign up with someone else's address and keep its owner out. If the owner clicked "confirm"
-- in the email that followed, they ended up co-holding a Mosaic ID someone else made.
--
-- 1. Only a verified address is reserved. The UNIQUE constraint on people.email gives way to a
--    unique index over verified addresses only. Unverified sign-ups may share an address, and
--    whoever verifies first keeps it. A later verify of the same address hits the index and is
--    refused (the app shows "that address is taken").
-- 2. people.email may be NULL. The daily job releases an address that is still unverified 24 hours
--    after sign-up. The Mosaic ID keeps its DID and passkeys and can add an address later. A
--    verified person always has an address (CHECK).
-- 3. identity.email_in_use counts verified addresses only.
-- 4. identity.remove_other_passkey: right after a recovery, the person may remove passkeys other
--    than the one the recovery just added. SECURITY DEFINER, so identity_app still has no DELETE
--    grant anywhere. It acts only for the person and the recover request in the transaction's
--    settings, only within 10 minutes of that request's use, and never on the passkey it added.
--    audit_log gains the action 'passkey_removed'.
-- 5. river.daily_job: as 20261026161614_auth_attempts_hour.sql (attempts kept an hour), plus the
--    address release in 2. Merge after that migration's PR.
--
-- Idempotent: every step checks before it changes anything.

-- 1, 2. Who holds an address ------------------------------------------------------------------
ALTER TABLE identity.people ALTER COLUMN email DROP NOT NULL;
ALTER TABLE identity.people DROP CONSTRAINT IF EXISTS people_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS people_verified_email_key
  ON identity.people (email) WHERE email_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS people_email_idx ON identity.people (email);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_verified_has_email') THEN
    ALTER TABLE identity.people
      ADD CONSTRAINT people_verified_has_email CHECK (email_verified_at IS NULL OR email IS NOT NULL);
  END IF;
END $$;

-- 3. Sign-up and change email: is this address someone's (verified) already? -------------------
CREATE OR REPLACE FUNCTION identity.email_in_use(p_email text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM identity.people WHERE email = lower(p_email) AND email_verified_at IS NOT NULL) $$;
REVOKE ALL ON FUNCTION identity.email_in_use(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.email_in_use(text) TO identity_app;

-- 4. Removing other passkeys after a recovery -------------------------------------------------
DO $$
BEGIN
  ALTER TABLE identity.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
  ALTER TABLE identity.audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN (
    'did_created', 'key_used', 'passkey_added', 'signin',
    'recovery_requested', 'recovered', 'email_verified', 'email_change_requested', 'did_recovered',
    'passkey_removed'
  ));
END $$;

-- The recover request (app.auth_request_id) records the passkey it added in pending
-- ->> 'new_credential_id' when it is used. p_at is the identity clock's time.
CREATE OR REPLACE FUNCTION identity.remove_other_passkey(p_passkey_id uuid, p_at timestamptz) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_person uuid := identity.current_person_id();
  v_keep text;
BEGIN
  IF v_person IS NULL THEN
    RETURN false;
  END IF;
  SELECT r.pending ->> 'new_credential_id' INTO v_keep
    FROM identity.auth_requests r
   WHERE r.id = identity.current_auth_request_id()
     AND r.purpose = 'recover'
     AND r.person_id = v_person
     AND r.used_at IS NOT NULL
     AND r.used_at > p_at - interval '10 minutes';
  IF v_keep IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM identity.passkeys
   WHERE id = p_passkey_id AND person_id = v_person AND credential_id <> v_keep;
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION identity.remove_other_passkey(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.remove_other_passkey(uuid, timestamptz) TO identity_app;

-- 5. The daily job ------------------------------------------------------------------------------
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
  released_addresses integer := 0;
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

  -- A sign-up's address still unverified 24 hours on is released: it was never reserved, and now
  -- the Mosaic ID stops naming it (it keeps its DID and passkeys, and may add an address later).
  IF to_regclass('identity.people') IS NOT NULL THEN
    EXECUTE 'UPDATE identity.people SET email = NULL
              WHERE email IS NOT NULL AND email_verified_at IS NULL AND created_at < $1'
      USING p_at - interval '24 hours';
    GET DIAGNOSTICS released_addresses = ROW_COUNT;
  END IF;

  restamped := river.restamp_samples(p_at);

  RETURN jsonb_build_object(
    'ended_follows', ended_follows,
    'kept_streams', kept_streams,
    'deleted_items', deleted_items,
    'deleted_follows', deleted_follows,
    'deleted_auth_attempts', deleted_attempts,
    'deleted_auth_requests', deleted_requests,
    'released_addresses', released_addresses,
    'restamped_samples', restamped
  );
END
$$;

REVOKE ALL ON FUNCTION river.daily_job(timestamptz) FROM PUBLIC;
