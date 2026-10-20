-- M1: the two schemas and the two app roles (spec 3, ADR-004).
--
-- river_app and identity_app are created NOLOGIN, without BYPASSRLS, idempotently. No password
-- ever goes in a migration: supabase/seed.sql makes them LOGIN with a local-only password for
-- local stacks and CI (applied by `supabase db reset` and `supabase start`, never by `db push`),
-- and Adam runs the same ALTER ROLE once on the hosted project with a generated password.
--
-- Each role gets USAGE on its own schema and nothing else here; table grants come with each
-- table, in the migration that creates it, next to its row-level security policies. Neither
-- schema is exposed through Supabase's Data API, and anon, authenticated and service_role get no
-- privileges on either.
--
-- Migrations run as `postgres`, which on Supabase (hosted and local) has CREATEROLE but is not a
-- superuser, so it cannot change SUPERUSER on an existing role. A role that already exists is
-- therefore checked rather than altered: if it carries one of those attributes, someone made it
-- by hand, and the migration stops rather than quietly building isolation on top of it. LOGIN
-- and the password are left alone, so re-running this after the password is set changes nothing.

DO $$
DECLARE
  r text;
  bad record;
BEGIN
  FOREACH r IN ARRAY ARRAY['river_app', 'identity_app'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION',
        r
      );
    END IF;

    SELECT rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb
      INTO bad
      FROM pg_roles
     WHERE rolname = r;
    IF bad.rolsuper OR bad.rolbypassrls OR bad.rolreplication OR bad.rolcreaterole OR bad.rolcreatedb THEN
      RAISE EXCEPTION
        'role % exists with SUPERUSER, BYPASSRLS, REPLICATION, CREATEROLE or CREATEDB; '
        'row-level security cannot isolate it. Fix the role by hand, then re-run.', r;
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS river;
CREATE SCHEMA IF NOT EXISTS identity;

-- Nobody but the owner and the schema's own role.
REVOKE ALL ON SCHEMA river FROM PUBLIC;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  -- Supabase's API roles exist on Supabase only; plain Postgres skips them.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA river FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA identity FROM %I', r);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA river TO river_app;
GRANT USAGE ON SCHEMA identity TO identity_app;

-- The settings forInstance() and forAccount() put in each transaction, as uuids. A setting that
-- was never set reads NULL; one set earlier in the session reads '' after its transaction ends;
-- both become NULL, which matches no row. A value that is not a uuid raises an error rather than
-- matching anything. STABLE and inlined, and every policy wraps the call in (SELECT ...) so it is
-- evaluated once per statement, not once per row.
CREATE OR REPLACE FUNCTION river.current_instance_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.instance_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION river.current_account_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.account_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION river.current_instance_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION river.current_account_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION river.current_instance_id() TO river_app;
GRANT EXECUTE ON FUNCTION river.current_account_id() TO river_app;
