-- A1, acting core (ADR-010; fediverse-posting-1.md item 8; space-actions-1.md 7): the four tables
-- the River needs to act for members, and the daily job's purges for them.
--
--   oauth_clients    One app registration per fediverse server and instance (instance rows). The
--                    client secret is sealed under RIVER_TOKEN_KEY with the additional data
--                    river-client:v1|{instance_id}|{host} (src/river/acting/crypto/credentials.ts).
--   linked_accounts  A member's channels (account rows): a fediverse account (kind 'fediverse') or
--                    a Mosaic ID signing grant (kind 'mosaic_grant'). The credential is sealed with
--                    river-token:v1|{instance_id}|{account_id}|{id}|{purpose}. Unlinking, a
--                    revocation elsewhere or 180 idle days delete the credential; the row stays,
--                    without it, for Your activity.
--   acting_attempts  One row per linking, grant or step-up round trip started (account rows): the
--                    state and the sealed PKCE verifier. Consumed once within 10 minutes; the
--                    daily job deletes them after a day.
--   member_actions   Every act (ADR-010 §7): the preview, then what was sent and what came back.
--                    Its id is the act's Idempotency-Key. Kept a year.
--
-- Credentials never leave the River's server; the columns hold only ciphertext (bytea) and the
-- master key's version. Every table: ENABLE and FORCE ROW LEVEL SECURITY, policies for river_app
-- only, and no column river_app may rewrite that names whose row it is. Deletes are the daily
-- job's (it runs as postgres), except that a member may delete their own linked accounts and
-- previews (a Sign-in DID change deletes grants, ADR-010 §6).
--
-- The daily job is replaced (from 20261026163500_email_reservation.sql) to add the purges:
-- previews older than 15 minutes, attempts older than a day, credentials idle 180 days, actions
-- older than a year, and ended links older than a year.
--
-- New tables only; nothing existing changes but river.daily_job. Not idempotent beyond the job's
-- CREATE OR REPLACE, like every migration that creates tables.

-- ---------------------------------------------------------------------------------------------
-- oauth_clients (instance)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.oauth_clients (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id              uuid NOT NULL DEFAULT river.current_instance_id() REFERENCES river.instances (id),
  host                     text NOT NULL
                             CHECK (length(host) <= 260
                                    AND host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$'),
  software                 text NOT NULL CHECK (software IN ('mastodon', 'gotosocial')),
  software_version         text NOT NULL CHECK (length(software_version) <= 64),
  client_id                text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 512),
  client_secret_ciphertext bytea NOT NULL CHECK (length(client_secret_ciphertext) BETWEEN 29 AND 4096),
  client_secret_dek        bytea NOT NULL CHECK (length(client_secret_dek) = 60),
  key_version              smallint NOT NULL CHECK (key_version >= 1),
  redirect_uri             text NOT NULL CHECK (redirect_uri LIKE 'https://%' OR redirect_uri LIKE 'http://localhost:%'),
  scopes                   text NOT NULL CHECK (length(scopes) <= 512),
  registered_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, host)
);

ALTER TABLE river.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.oauth_clients FORCE ROW LEVEL SECURITY;
CREATE POLICY oauth_clients_instance ON river.oauth_clients FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id()));
-- A server that forgot the app is registered again: the row is deleted and a new one inserted.
GRANT SELECT, INSERT, DELETE ON river.oauth_clients TO river_app;
GRANT UPDATE (software, software_version) ON river.oauth_clients TO river_app;

-- ---------------------------------------------------------------------------------------------
-- linked_accounts (account)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.linked_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id        uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id         uuid NOT NULL DEFAULT river.current_account_id(),
  kind               text NOT NULL CHECK (kind IN ('fediverse', 'mosaic_grant')),
  -- The fediverse server, or Mosaic ID's host for a grant.
  server_host        text NOT NULL
                       CHECK (length(server_host) <= 260
                              AND server_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$'),
  -- The fediverse actor's URI, or the DID a grant is for.
  actor_uri          text NOT NULL CHECK (length(actor_uri) BETWEEN 1 AND 2048),
  acct               text CHECK (length(acct) <= 512),
  remote_account_id  text CHECK (length(remote_account_id) <= 256),
  display_name       text CHECK (length(display_name) <= 512),
  avatar_url         text CHECK (length(avatar_url) <= 2048),
  software           text CHECK (software IN ('mastodon', 'gotosocial')),
  scopes             text NOT NULL DEFAULT '' CHECK (length(scopes) <= 512),
  token_ciphertext   bytea CHECK (length(token_ciphertext) BETWEEN 29 AND 8192),
  token_dek          bytea CHECK (length(token_dek) = 60),
  token_key_version  smallint CHECK (token_key_version >= 1),
  default_visibility text CHECK (default_visibility IN ('public', 'unlisted', 'private')),
  default_language   text CHECK (length(default_language) <= 16),
  -- active: holds a credential. revoked: refused by the other side. unlinked: the member unlinked.
  -- lapsed: unused for 180 days (the daily job). Only an active link holds a credential.
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'unlinked', 'lapsed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  -- When the credential was deleted, for whatever reason.
  revoked_at         timestamptz,
  UNIQUE (account_id, actor_uri),
  UNIQUE (account_id, id),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE,
  CONSTRAINT linked_accounts_credential_whole CHECK (
    (token_ciphertext IS NULL) = (token_dek IS NULL) AND (token_dek IS NULL) = (token_key_version IS NULL)
  ),
  CONSTRAINT linked_accounts_credential_when_active CHECK (
    (status = 'active') = (token_ciphertext IS NOT NULL)
  ),
  CONSTRAINT linked_accounts_ended_when CHECK ((status = 'active') = (revoked_at IS NULL))
);
CREATE INDEX linked_accounts_idle_idx ON river.linked_accounts (coalesce(last_used_at, created_at)) WHERE status = 'active';

ALTER TABLE river.linked_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.linked_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_accounts_own ON river.linked_accounts FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT, DELETE ON river.linked_accounts TO river_app;
-- Everything but the row's identity (id, instance, account, kind, server, actor).
GRANT UPDATE (acct, remote_account_id, display_name, avatar_url, software, scopes, token_ciphertext,
              token_dek, token_key_version, default_visibility, default_language, status,
              last_used_at, revoked_at)
  ON river.linked_accounts TO river_app;

-- ---------------------------------------------------------------------------------------------
-- acting_attempts (account)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.acting_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id           uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id            uuid NOT NULL DEFAULT river.current_account_id(),
  state                 text NOT NULL UNIQUE CHECK (state ~ '^[A-Za-z0-9_-]{32,128}$'),
  purpose               text NOT NULL CHECK (purpose IN ('fediverse_link', 'grant', 'step_up')),
  server_host           text NOT NULL
                          CHECK (length(server_host) <= 260
                                 AND server_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$'),
  -- What the member asked for: the handle they typed, or the action being stepped up.
  requested             text CHECK (length(requested) <= 2048),
  -- Where the member goes back to on the River: a path, never another origin.
  return_to             text CHECK (return_to ~ '^/([^/\\]|$)' AND length(return_to) <= 2048),
  verifier_ciphertext   bytea CHECK (length(verifier_ciphertext) BETWEEN 29 AND 1024),
  verifier_dek          bytea CHECK (length(verifier_dek) = 60),
  verifier_key_version  smallint CHECK (verifier_key_version >= 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  used_at               timestamptz,
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE,
  CONSTRAINT acting_attempts_verifier_whole CHECK (
    (verifier_ciphertext IS NULL) = (verifier_dek IS NULL) AND (verifier_dek IS NULL) = (verifier_key_version IS NULL)
  )
);
CREATE INDEX acting_attempts_created_idx ON river.acting_attempts (created_at);

ALTER TABLE river.acting_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.acting_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY acting_attempts_own ON river.acting_attempts FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
-- New attempts only; the callback marks one used (UPDATE ... WHERE used_at IS NULL RETURNING).
GRANT SELECT, INSERT ON river.acting_attempts TO river_app;
GRANT UPDATE (used_at) ON river.acting_attempts TO river_app;

-- ---------------------------------------------------------------------------------------------
-- member_actions (account)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.member_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id        uuid NOT NULL DEFAULT river.current_account_id(),
  channel           text NOT NULL CHECK (channel IN ('fediverse', 'space')),
  -- The linked account or grant it went through; kept as NULL once that link is purged.
  linked_account_id uuid,
  -- The server or space it goes to, and how the member sees the target ("@ana@example.social").
  target_host       text NOT NULL
                      CHECK (length(target_host) <= 260
                             AND target_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$'),
  target_label      text CHECK (length(target_label) <= 512),
  verb              text NOT NULL CHECK (verb IN (
                      'post', 'reply', 'comment', 'poll_answer',
                      'boost', 'unboost', 'favourite', 'unfavourite', 'support', 'rsvp', 'withdraw',
                      'follow', 'unfollow',
                      'delete')),
  -- ADR-010 §9's limit kinds; the CHECK below ties each verb to its kind.
  limit_kind        text NOT NULL CHECK (limit_kind IN ('text', 'toggle', 'follow', 'delete')),
  -- The item it answers, while the River still has it, and its title and link for the list.
  item_id           uuid REFERENCES river.items (id) ON DELETE SET NULL,
  subject_title     text CHECK (length(subject_title) <= 1024),
  subject_url       text CHECK (length(subject_url) <= 2048),
  -- The request as previewed and sent (method, URL, fields; never a credential). Erased when the
  -- member deletes or withdraws what it made (ADR-010 §7).
  request           jsonb CHECK (request IS NULL OR pg_column_size(request) <= 65536),
  status            text NOT NULL DEFAULT 'previewed'
                      CHECK (status IN ('previewed', 'sent', 'held', 'failed', 'unknown', 'undone')),
  remote_id         text CHECK (length(remote_id) <= 512),
  remote_url        text CHECK (length(remote_url) <= 2048),
  error_code        text CHECK (length(error_code) <= 64),
  -- The other side's own words, plain text, at most 300 characters (ADR-010 §9).
  error_message     text CHECK (length(error_message) <= 300),
  -- The account's session epoch when the row was written; Send refuses a row from an older one.
  session_epoch     integer NOT NULL CHECK (session_epoch >= 1),
  -- The act this one undoes.
  undoes_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  UNIQUE (account_id, id),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, linked_account_id) REFERENCES river.linked_accounts (account_id, id)
    ON DELETE SET NULL (linked_account_id),
  FOREIGN KEY (account_id, undoes_id) REFERENCES river.member_actions (account_id, id)
    ON DELETE SET NULL (undoes_id),
  CONSTRAINT member_actions_limit_kind CHECK (
    limit_kind = CASE
      WHEN verb IN ('post', 'reply', 'comment', 'poll_answer') THEN 'text'
      WHEN verb IN ('follow', 'unfollow') THEN 'follow'
      WHEN verb = 'delete' THEN 'delete'
      ELSE 'toggle'
    END
  )
);
-- Your activity (newest first) and the limits' rolling windows.
CREATE INDEX member_actions_account_created_idx ON river.member_actions (account_id, created_at DESC);
CREATE INDEX member_actions_created_idx ON river.member_actions (created_at);

ALTER TABLE river.member_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.member_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY member_actions_own ON river.member_actions FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT ON river.member_actions TO river_app;
-- The outcome, and the erasure of the text; never who, what verb, where or when.
GRANT UPDATE (status, request, subject_title, remote_id, remote_url, error_code, error_message, sent_at)
  ON river.member_actions TO river_app;
-- A member's own unsent preview may be discarded; sent rows stay for the year.
CREATE POLICY member_actions_discard_preview ON river.member_actions AS RESTRICTIVE FOR DELETE TO river_app
  USING (status = 'previewed');
GRANT DELETE ON river.member_actions TO river_app;

-- ---------------------------------------------------------------------------------------------
-- The daily job, with the acting purges
-- ---------------------------------------------------------------------------------------------
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
     AND coalesce(last_used_at, created_at) < p_at - interval '180 days';
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
    'deleted_auth_requests', deleted_requests,
    'released_addresses', released_addresses,
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
