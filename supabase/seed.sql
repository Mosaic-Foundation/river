-- Local stacks and CI only. `npx supabase start` and `npx supabase db reset` apply this after the
-- migrations; `supabase db push` never does, so none of it reaches the hosted project.
--
-- The migrations create river_app and identity_app as NOLOGIN with no password (ADR-004). Here
-- they become LOGIN roles with the shared local password, which .env.example and
-- .env.identity.example use. On the hosted project Adam runs the same two statements once in the
-- SQL editor, each with its own generated password (build hand-off, "database role passwords").
ALTER ROLE river_app LOGIN PASSWORD 'local-only';
ALTER ROLE identity_app LOGIN PASSWORD 'local-only';

-- A second instance, so the database tests can prove one instance never sees another's rows
-- (acceptance check 27). Its hostname can't resolve anywhere.
INSERT INTO river.instances (id, hostname, name, modes_enabled, default_mode)
VALUES ('00000000-0000-4000-8000-0000000000e2', 'isolation-test.invalid', 'Isolation test',
        ARRAY['everything'], 'everything')
ON CONFLICT (hostname) DO NOTHING;
