-- M8: the River's side of sign-in (spec 3.1, 4.6 "Sign-in note"; ADR-002).
--
--   login_methods  How an account signs in: kind 'did' in v1, with the DID and its SCID. UNIQUE
--                  (instance_id, kind, scid): one DID holds one account on each instance, and the
--                  SCID finds the same account after the DID moves host or is re-keyed
--                  (recover-dids). A member's own rows (account kind in src/db/tables.ts).
--   auth_attempts  One row per sign-in started (state, nonce). The callback consumes it once,
--                  atomically. Rows of one instance; river_app may only insert them.
--
-- Two SECURITY DEFINER functions (owner postgres, which bypasses row-level security; empty
-- search_path; EXECUTE for river_app only) cover the two steps that run before an account is
-- known, each scoped to the transaction's app.instance_id and returning one value, never a row:
--
--   river.account_for_login(kind, scid)  the account holding this login method, or NULL
--   river.consume_auth_attempt(state)    marks the attempt used and returns its nonce, or NULL
--                                        when it is unknown, used, older than 10 minutes, or
--                                        another instance's
--
-- The daily job (20261021120000_daily_job.sql) already deletes auth_attempts older than a day by
-- created_at once this table exists.

-- ---------------------------------------------------------------------------------------------
-- login_methods (account)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.login_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id   uuid NOT NULL DEFAULT river.current_account_id(),
  kind         text NOT NULL CHECK (kind IN ('did')),
  did          text NOT NULL CHECK (did LIKE 'did:%' AND length(did) <= 512),
  scid         text NOT NULL CHECK (scid ~ '^[A-Za-z0-9]{16,128}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, kind, scid),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE
);
CREATE INDEX login_methods_account_idx ON river.login_methods (account_id);

ALTER TABLE river.login_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.login_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY login_methods_own ON river.login_methods FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT ON river.login_methods TO river_app;
-- A DID keeps its SCID when it moves; the stored DID follows it.
GRANT UPDATE (did, last_used_at) ON river.login_methods TO river_app;

-- ---------------------------------------------------------------------------------------------
-- auth_attempts (instance; insert only)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.auth_attempts (
  state       text PRIMARY KEY CHECK (state ~ '^[A-Za-z0-9_-]{32,128}$'),
  instance_id uuid NOT NULL DEFAULT river.current_instance_id() REFERENCES river.instances (id),
  nonce       text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz
);
CREATE INDEX auth_attempts_created_idx ON river.auth_attempts (created_at);

ALTER TABLE river.auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.auth_attempts FORCE ROW LEVEL SECURITY;
-- river_app writes new, unused attempts for its own instance and nothing else: no SELECT, UPDATE
-- or DELETE. Reading one back happens only through consume_auth_attempt().
CREATE POLICY auth_attempts_insert ON river.auth_attempts FOR INSERT TO river_app
  WITH CHECK (instance_id = (SELECT river.current_instance_id()) AND used_at IS NULL);
GRANT INSERT ON river.auth_attempts TO river_app;

-- ---------------------------------------------------------------------------------------------
-- The two steps before an account is known
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION river.consume_auth_attempt(p_state text) RETURNS text
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  UPDATE river.auth_attempts
     SET used_at = now()
   WHERE state = p_state
     AND instance_id = river.current_instance_id()
     AND used_at IS NULL
     AND created_at > now() - interval '10 minutes'
  RETURNING nonce
$$;

CREATE FUNCTION river.account_for_login(p_kind text, p_scid text) RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT account_id
    FROM river.login_methods
   WHERE instance_id = river.current_instance_id()
     AND kind = p_kind
     AND scid = p_scid
$$;

REVOKE ALL ON FUNCTION river.consume_auth_attempt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION river.account_for_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION river.consume_auth_attempt(text) TO river_app;
GRANT EXECUTE ON FUNCTION river.account_for_login(text, text) TO river_app;
