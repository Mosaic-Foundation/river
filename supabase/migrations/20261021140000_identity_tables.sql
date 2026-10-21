-- M7: the identity schema (spec 3.2, 4.6; ADR-002, ADR-004).
--
-- Seven tables: people, passkeys, did_log, keys, auth_requests, audit_log, recovery_tokens. The
-- `clients` of 3.2 is not a table; the identity host builds it at startup from
-- RIVER_CLIENT_ORIGINS. Every table has ENABLE and FORCE ROW LEVEL SECURITY, one policy for
-- identity_app only, and grants for identity_app only. river_app has no USAGE on this schema
-- (20261020213532_roles_and_schemas.sql), so it can neither read these tables nor call these
-- functions; the River never stores or receives email addresses or private keys (constraint 7).
--
-- What the policies key on (forIdentity() in src/db/context.ts sets them with set_config(..., true)):
--   app.person_id        a person's own rows in every person table
--   app.auth_request_id  one auth_requests row; its random id is the capability the browser holds
-- A transaction with neither set sees no row at all.
--
-- Before a person is known (sign-in by passkey, a recovery request by address, an emailed link,
-- serving did.jsonl by code) the app asks one of the narrow SECURITY DEFINER lookups below, each
-- returning a person id (or a yes/no) and nothing else, then opens forIdentity() for that person.

CREATE OR REPLACE FUNCTION identity.current_person_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION identity.current_auth_request_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.auth_request_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION identity.current_person_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION identity.current_auth_request_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.current_person_id() TO identity_app;
GRANT EXECUTE ON FUNCTION identity.current_auth_request_id() TO identity_app;

-- ---------------------------------------------------------------------------------------------
-- people: one per person. `code` is the DID's last path segment; `webauthn_user_id` is the
-- passkeys' user handle (32 random bytes, never the code, DID or email). Email is stored
-- lowercased, so the unique index is the one place it is compared.

CREATE TABLE identity.people (
  id uuid PRIMARY KEY DEFAULT identity.current_person_id(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z2-7]{8}$'),
  did text NOT NULL UNIQUE CHECK (did LIKE 'did:webvh:%'),
  scid text NOT NULL UNIQUE,
  display_name text CHECK (char_length(display_name) BETWEEN 1 AND 64),
  webauthn_user_id bytea NOT NULL UNIQUE CHECK (octet_length(webauthn_user_id) = 32),
  email text NOT NULL UNIQUE
    CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- passkeys: discoverable WebAuthn credentials. credential_id is base64url, as the browser sends it.

CREATE TABLE identity.passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL DEFAULT identity.current_person_id()
    REFERENCES identity.people (id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE
    CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND char_length(credential_id) BETWEEN 16 AND 1364),
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkeys_person_id_idx ON identity.passkeys (person_id);

-- ---------------------------------------------------------------------------------------------
-- did_log: the person's did:webvh log, one JSON line per version. Append-only: identity_app may
-- only SELECT and INSERT, and a trigger refuses UPDATE and DELETE from anyone. The app appends
-- in one transaction holding a row lock on the person (SELECT ... FOR UPDATE on people).

CREATE TABLE identity.did_log (
  person_id uuid NOT NULL DEFAULT identity.current_person_id()
    REFERENCES identity.people (id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  entry text NOT NULL CHECK (position(E'\n' IN entry) = 0 AND jsonb_typeof(entry::jsonb) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, version_number)
);

CREATE OR REPLACE FUNCTION identity.did_log_is_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'identity.did_log is append-only';
END
$$;
REVOKE ALL ON FUNCTION identity.did_log_is_append_only() FROM PUBLIC;

CREATE TRIGGER did_log_append_only
  BEFORE UPDATE OR DELETE ON identity.did_log
  FOR EACH ROW EXECUTE FUNCTION identity.did_log_is_append_only();

-- ---------------------------------------------------------------------------------------------
-- keys: the person's Ed25519 key under envelope encryption (spec 3.2, Appendix B). The private key
-- is encrypted with a per-person AES-256-GCM data key; the data key is wrapped with
-- IDENTITY_MASTER_KEY; both use the DID as additional authenticated data. Both columns are
-- iv (12 bytes) || tag (16 bytes) || ciphertext. At most one key per person is active.

CREATE TABLE identity.keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL DEFAULT identity.current_person_id()
    REFERENCES identity.people (id) ON DELETE CASCADE,
  kid text NOT NULL,
  public_jwk jsonb NOT NULL CHECK (public_jwk ->> 'kty' = 'OKP' AND public_jwk ->> 'crv' = 'Ed25519'
                                   AND NOT public_jwk ? 'd'),
  private_key_ciphertext bytea NOT NULL CHECK (octet_length(private_key_ciphertext) > 28),
  wrapped_dek bytea NOT NULL CHECK (octet_length(wrapped_dek) = 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);
CREATE UNIQUE INDEX keys_one_active_per_person ON identity.keys (person_id) WHERE retired_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- auth_requests: one per WebAuthn ceremony (spec 4.6 step 2), 10 minutes. `purpose` says which:
-- authorize (the River's sign-in redirect; also sign-up from that page), recover (a new passkey
-- from an emailed link) or change_email (a fresh passkey check). Client fields are all set or all
-- null; a recover row copies them from the authorize request it continues. `pending` holds what a
-- ceremony needs between its two steps (a sign-up's address and user handle; a new address).
-- The daily job (20261021120000_daily_job.sql) deletes rows a day after they expire.

CREATE TABLE identity.auth_requests (
  id uuid PRIMARY KEY DEFAULT identity.current_auth_request_id(),
  purpose text NOT NULL CHECK (purpose IN ('authorize', 'recover', 'change_email')),
  client_id text,
  redirect_uri text,
  state text,
  nonce text,
  person_id uuid REFERENCES identity.people (id) ON DELETE CASCADE,
  pending jsonb NOT NULL DEFAULT '{}'::jsonb,
  webauthn_challenge text NOT NULL CHECK (webauthn_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (num_nulls(client_id, redirect_uri, state, nonce) IN (0, 4)),
  CHECK (purpose <> 'authorize' OR client_id IS NOT NULL),
  CHECK (purpose <> 'recover' OR person_id IS NOT NULL),
  CHECK (expires_at <= created_at + interval '10 minutes')
);

-- ---------------------------------------------------------------------------------------------
-- audit_log: every key use, sign-in, passkey, recovery and email change (spec 3.2, Appendix B).
-- identity_app may only SELECT and INSERT.

CREATE TABLE identity.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL DEFAULT identity.current_person_id()
    REFERENCES identity.people (id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'did_created', 'key_used', 'passkey_added', 'signin',
    'recovery_requested', 'recovered', 'email_verified', 'email_change_requested', 'did_recovered'
  )),
  at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_person_at_idx ON identity.audit_log (person_id, at);

-- ---------------------------------------------------------------------------------------------
-- recovery_tokens: emailed single-use links (spec 3.2). Only the SHA-256 of the 32-byte token is
-- stored. verify_email rows carry the address they verify (the sign-up address, or a new one
-- being changed to); recover rows may name the authorize request the link continues.

CREATE TABLE identity.recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL DEFAULT identity.current_person_id()
    REFERENCES identity.people (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'recover')),
  email text CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  auth_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK ((purpose = 'verify_email') = (email IS NOT NULL)),
  CHECK (purpose = 'recover' OR auth_request_id IS NULL),
  CHECK (expires_at <= created_at + CASE purpose WHEN 'recover' THEN interval '15 minutes'
                                                 ELSE interval '24 hours' END)
);
CREATE INDEX recovery_tokens_person_created_idx ON identity.recovery_tokens (person_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- Row-level security: ENABLE and FORCE on every table, one policy each, for identity_app only.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['people', 'passkeys', 'did_log', 'keys', 'auth_requests', 'audit_log',
                           'recovery_tokens'] LOOP
    EXECUTE format('ALTER TABLE identity.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE identity.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON identity.%I FROM PUBLIC', t);
  END LOOP;
END $$;

CREATE POLICY people_own ON identity.people
  FOR ALL TO identity_app
  USING (id = (SELECT identity.current_person_id()))
  WITH CHECK (id = (SELECT identity.current_person_id()));

CREATE POLICY passkeys_own ON identity.passkeys
  FOR ALL TO identity_app
  USING (person_id = (SELECT identity.current_person_id()))
  WITH CHECK (person_id = (SELECT identity.current_person_id()));

CREATE POLICY did_log_own ON identity.did_log
  FOR ALL TO identity_app
  USING (person_id = (SELECT identity.current_person_id()))
  WITH CHECK (person_id = (SELECT identity.current_person_id()));

CREATE POLICY keys_own ON identity.keys
  FOR ALL TO identity_app
  USING (person_id = (SELECT identity.current_person_id()))
  WITH CHECK (person_id = (SELECT identity.current_person_id()));

CREATE POLICY audit_log_own ON identity.audit_log
  FOR ALL TO identity_app
  USING (person_id = (SELECT identity.current_person_id()))
  WITH CHECK (person_id = (SELECT identity.current_person_id()));

CREATE POLICY recovery_tokens_own ON identity.recovery_tokens
  FOR ALL TO identity_app
  USING (person_id = (SELECT identity.current_person_id()))
  WITH CHECK (person_id = (SELECT identity.current_person_id()));

-- A request row is reachable only by its id; a row naming a person must name the context's.
CREATE POLICY auth_requests_by_id ON identity.auth_requests
  FOR ALL TO identity_app
  USING (id = (SELECT identity.current_auth_request_id()))
  WITH CHECK (
    id = (SELECT identity.current_auth_request_id())
    AND (person_id IS NULL OR person_id = (SELECT identity.current_person_id()))
  );

-- Grants: the commands each table needs, nothing more. No DELETE anywhere; no UPDATE on did_log,
-- audit_log or any key material.
GRANT SELECT, INSERT ON identity.people TO identity_app;
GRANT UPDATE (email, email_verified_at, display_name) ON identity.people TO identity_app;
GRANT SELECT, INSERT ON identity.passkeys TO identity_app;
GRANT UPDATE (counter, last_used_at) ON identity.passkeys TO identity_app;
GRANT SELECT, INSERT ON identity.did_log TO identity_app;
GRANT SELECT, INSERT ON identity.keys TO identity_app;
GRANT UPDATE (retired_at) ON identity.keys TO identity_app;
GRANT SELECT, INSERT ON identity.auth_requests TO identity_app;
GRANT UPDATE (webauthn_challenge, pending, used_at) ON identity.auth_requests TO identity_app;
GRANT SELECT, INSERT ON identity.audit_log TO identity_app;
GRANT SELECT, INSERT ON identity.recovery_tokens TO identity_app;
GRANT UPDATE (used_at) ON identity.recovery_tokens TO identity_app;

-- ---------------------------------------------------------------------------------------------
-- Lookups before a person is known. SECURITY DEFINER (owner postgres, which bypasses RLS), an
-- empty search_path, EXECUTE for identity_app only. Each returns an id or a boolean, never a row.

-- Sign-in: which person holds this discoverable credential?
CREATE OR REPLACE FUNCTION identity.person_by_credential(p_credential_id text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT person_id FROM identity.passkeys WHERE credential_id = p_credential_id $$;

-- did.jsonl and recover-dids: whose DID ends in this code?
CREATE OR REPLACE FUNCTION identity.person_by_code(p_code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT id FROM identity.people WHERE code = p_code $$;

-- "Lost your passkey?": the person with this address, only once it is verified (spec 4.6).
CREATE OR REPLACE FUNCTION identity.person_for_recovery(p_email text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT id FROM identity.people WHERE email = lower(p_email) AND email_verified_at IS NOT NULL $$;

-- Sign-up and change email: is this address someone's already?
CREATE OR REPLACE FUNCTION identity.email_in_use(p_email text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM identity.people WHERE email = lower(p_email)) $$;

-- An emailed link: whose token has this hash? The caller checks purpose, expiry and use under
-- that person's context.
CREATE OR REPLACE FUNCTION identity.person_by_token(p_token_hash bytea) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT person_id FROM identity.recovery_tokens WHERE token_hash = p_token_hash $$;

-- recover-dids --all: every person's code (codes are public; they are in every DID).
CREATE OR REPLACE FUNCTION identity.person_codes() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT code FROM identity.people ORDER BY created_at, code $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'identity.person_by_credential(text)', 'identity.person_by_code(text)',
    'identity.person_for_recovery(text)', 'identity.email_in_use(text)',
    'identity.person_by_token(bytea)', 'identity.person_codes()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO identity_app', f);
  END LOOP;
END $$;

-- Supabase's API roles get nothing here (the schema is not exposed through the Data API).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity FROM %I', r);
    END IF;
  END LOOP;
END $$;
