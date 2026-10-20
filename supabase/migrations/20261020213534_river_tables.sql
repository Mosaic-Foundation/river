-- M1: the River's tables (spec 3.1), each with ENABLE and FORCE ROW LEVEL SECURITY, its policies
-- and its grants to river_app in this same migration (ADR-004).
--
-- Four kinds of table, and src/db/tables.ts lists every one with its kind:
--
--   config    instances. Operator-owned (written by migrations only); river_app may read every
--             row, because the hostname picks the instance before any instance is known.
--   instance  accounts, circle_members. Rows of one instance. accounts narrows further to the
--             caller's own row once app.account_id is set.
--   account   follows, circles, read_state, preferences. Rows of one member of one instance:
--             visible and writable only when both app.instance_id and app.account_id match.
--   shared    spaces, streams, items. Public source data every account reads (spec 3: "allow
--             read to river_app regardless of account"). They still require app.instance_id to
--             be set, so a query that skipped forInstance()/forAccount() sees nothing.
--
-- Policies compare against current_setting('app.instance_id', true) and
-- current_setting('app.account_id', true), through river.current_instance_id() and
-- river.current_account_id() (previous migration), each wrapped in (SELECT ...) so it is
-- evaluated once per statement. The id columns default to those settings, so the database stamps
-- them even when a query leaves them out, and every WITH CHECK refuses another instance's or
-- account's id. Composite foreign keys (instance_id, account_id) refuse a row that points across
-- instances even before a policy is consulted.
--
-- Login methods and auth attempts arrive with sign-in (M8), the hub activity allowlist with the
-- Civic Hub adapter (M3), and the identity tables with the identity host (M7).

-- ---------------------------------------------------------------------------------------------
-- instances (config)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname        text NOT NULL UNIQUE,
  name            text NOT NULL,
  theme           text NOT NULL DEFAULT 'mosaic' CHECK (theme IN ('mosaic', 'civic')),
  modes_enabled   text[] NOT NULL DEFAULT ARRAY['everything', 'civic'],
  default_mode    text NOT NULL DEFAULT 'everything',
  -- [{ url, stream_key?, circles: [name] }]
  seed_follows    jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(seed_follows) = 'array'),
  -- [{ name, color, role?, members: [url] }]
  default_circles jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(default_circles) = 'array'),
  plugins         jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(modes_enabled) > 0),
  CHECK (default_mode = ANY (modes_enabled))
);

ALTER TABLE river.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.instances FORCE ROW LEVEL SECURITY;
CREATE POLICY instances_read ON river.instances FOR SELECT TO river_app USING (true);
GRANT SELECT ON river.instances TO river_app;

-- ---------------------------------------------------------------------------------------------
-- accounts (instance; a member sees only their own row)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid NOT NULL DEFAULT river.current_instance_id() REFERENCES river.instances (id),
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, id)
);

ALTER TABLE river.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_isolation ON river.accounts FOR ALL TO river_app
  USING (
    instance_id = (SELECT river.current_instance_id())
    AND ((SELECT river.current_account_id()) IS NULL OR id = (SELECT river.current_account_id()))
  )
  WITH CHECK (
    instance_id = (SELECT river.current_instance_id())
    AND ((SELECT river.current_account_id()) IS NULL OR id = (SELECT river.current_account_id()))
  );
GRANT SELECT, INSERT, UPDATE ON river.accounts TO river_app;

-- ---------------------------------------------------------------------------------------------
-- spaces, streams, items (shared)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.spaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter          text NOT NULL
                   CHECK (adapter IN ('civic_hub', 'fediverse', 'sample', 'rep_space_v01', 'atproto')),
  canonical_url    text NOT NULL UNIQUE,
  feed_url         text,
  actor_id         text,
  network          text,
  category         text CHECK (category IN (
                     'civic', 'news', 'publication', 'club', 'family', 'neighborhood',
                     'podcast', 'video', 'person', 'organization')),
  name             text NOT NULL,
  icon_url         text,
  home_url         text,
  manifest         jsonb NOT NULL DEFAULT '{}',
  etag             text,
  etag_url         text,
  newest_item_at   timestamptz,
  last_fetched_at  timestamptz,
  fetch_lock_until timestamptz,
  fetch_status     text CHECK (fetch_status IN ('ok', 'error', 'blocked')),
  error_count      integer NOT NULL DEFAULT 0,
  last_error       text
);

CREATE TABLE river.streams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        uuid NOT NULL REFERENCES river.spaces (id) ON DELETE CASCADE,
  key             text NOT NULL,
  title           text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ended')),
  ended_at        timestamptz,
  last_checked_at timestamptz,
  UNIQUE (space_id, key),
  -- Lets follows check that a followed stream belongs to the followed space.
  UNIQUE (space_id, id)
);

CREATE TABLE river.items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        uuid NOT NULL REFERENCES river.spaces (id) ON DELETE CASCADE,
  stream_key      text,
  source_id       text NOT NULL,
  kind            text NOT NULL
                  CHECK (kind IN ('post', 'article', 'podcast', 'video', 'photo', 'event', 'civic')),
  published_at    timestamptz NOT NULL,
  title           text,
  summary         text,
  content_html    text,
  url             text,
  author          jsonb,
  media           jsonb NOT NULL DEFAULT '[]',
  boost_of        jsonb,
  audience        text NOT NULL DEFAULT 'public' CHECK (audience IN ('public')),
  -- Reserved for credential-gated content (spec 5); always null in v1. No foreign key: items are
  -- shared across instances and accounts belong to one.
  account_id      uuid,
  civic           jsonb,
  is_final_result boolean NOT NULL DEFAULT false,
  hidden          boolean NOT NULL DEFAULT false,
  raw             jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  -- 'simple': no stemming, so any language matches as written. The parser drops HTML tags.
  search          tsvector GENERATED ALWAYS AS (
                    to_tsvector('simple'::regconfig,
                      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
                      coalesce(content_html, ''))
                  ) STORED,
  UNIQUE (space_id, source_id)
);

CREATE INDEX items_space_published_idx ON river.items (space_id, published_at DESC);
CREATE INDEX items_space_stream_idx ON river.items (space_id, stream_key);
CREATE INDEX items_search_idx ON river.items USING gin (search);

ALTER TABLE river.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY spaces_shared ON river.spaces FOR ALL TO river_app
  USING ((SELECT river.current_instance_id()) IS NOT NULL)
  WITH CHECK ((SELECT river.current_instance_id()) IS NOT NULL);
GRANT SELECT, INSERT, UPDATE ON river.spaces TO river_app;

ALTER TABLE river.streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.streams FORCE ROW LEVEL SECURITY;
CREATE POLICY streams_shared ON river.streams FOR ALL TO river_app
  USING ((SELECT river.current_instance_id()) IS NOT NULL)
  WITH CHECK ((SELECT river.current_instance_id()) IS NOT NULL);
GRANT SELECT, INSERT, UPDATE ON river.streams TO river_app;

-- Public items are shared; a non-public item (none in v1) would be visible only to its account.
-- Writes are public items only.
ALTER TABLE river.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.items FORCE ROW LEVEL SECURITY;
CREATE POLICY items_read ON river.items FOR SELECT TO river_app
  USING (
    (SELECT river.current_instance_id()) IS NOT NULL
    AND (audience = 'public' OR account_id = (SELECT river.current_account_id()))
  );
CREATE POLICY items_insert ON river.items FOR INSERT TO river_app
  WITH CHECK (
    (SELECT river.current_instance_id()) IS NOT NULL AND audience = 'public' AND account_id IS NULL
  );
CREATE POLICY items_update ON river.items FOR UPDATE TO river_app
  USING ((SELECT river.current_instance_id()) IS NOT NULL AND audience = 'public')
  WITH CHECK (
    (SELECT river.current_instance_id()) IS NOT NULL AND audience = 'public' AND account_id IS NULL
  );
GRANT SELECT, INSERT, UPDATE ON river.items TO river_app;

-- ---------------------------------------------------------------------------------------------
-- follows, circles, circle_members, read_state, preferences (a member's own rows)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE river.follows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id      uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id       uuid NOT NULL DEFAULT river.current_account_id(),
  space_id         uuid NOT NULL REFERENCES river.spaces (id) ON DELETE CASCADE,
  stream_id        uuid,
  rule             text NOT NULL DEFAULT 'follow' CHECK (rule IN ('follow', 'mute')),
  ends_with_stream boolean NOT NULL DEFAULT false,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (account_id, space_id, stream_id),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE,
  -- A stream rule must name a stream of the same space (skipped when stream_id is null).
  FOREIGN KEY (space_id, stream_id) REFERENCES river.streams (space_id, id) ON DELETE CASCADE
);
CREATE INDEX follows_space_idx ON river.follows (space_id);

CREATE TABLE river.circles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id  uuid NOT NULL DEFAULT river.current_account_id(),
  name        text NOT NULL,
  color       text,
  role        text CHECK (role IN ('civic')),
  sort        integer NOT NULL DEFAULT 0,
  UNIQUE (instance_id, id),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE
);
CREATE INDEX circles_account_idx ON river.circles (account_id);
-- One circle per account carries role = civic (spec F8).
CREATE UNIQUE INDEX circles_one_civic_per_account ON river.circles (account_id) WHERE role = 'civic';

-- No account_id (spec 3.1): a member's circle_members rows are those of their own circles.
CREATE TABLE river.circle_members (
  instance_id uuid NOT NULL DEFAULT river.current_instance_id(),
  circle_id   uuid NOT NULL,
  space_id    uuid NOT NULL REFERENCES river.spaces (id) ON DELETE CASCADE,
  PRIMARY KEY (circle_id, space_id),
  FOREIGN KEY (instance_id, circle_id) REFERENCES river.circles (instance_id, id) ON DELETE CASCADE
);
CREATE INDEX circle_members_space_idx ON river.circle_members (space_id);

CREATE TABLE river.read_state (
  instance_id uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id  uuid NOT NULL DEFAULT river.current_account_id(),
  item_id     uuid NOT NULL REFERENCES river.items (id) ON DELETE CASCADE,
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE
);

CREATE TABLE river.preferences (
  instance_id uuid NOT NULL DEFAULT river.current_instance_id(),
  account_id  uuid NOT NULL DEFAULT river.current_account_id(),
  key         text NOT NULL,
  value       jsonb NOT NULL,
  PRIMARY KEY (account_id, key),
  FOREIGN KEY (instance_id, account_id) REFERENCES river.accounts (instance_id, id) ON DELETE CASCADE
);

ALTER TABLE river.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.follows FORCE ROW LEVEL SECURITY;
CREATE POLICY follows_own ON river.follows FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON river.follows TO river_app;

ALTER TABLE river.circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.circles FORCE ROW LEVEL SECURITY;
CREATE POLICY circles_own ON river.circles FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON river.circles TO river_app;

-- The subquery reads circles under circles' own policy, so it only ever finds the caller's.
ALTER TABLE river.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.circle_members FORCE ROW LEVEL SECURITY;
CREATE POLICY circle_members_own ON river.circle_members FOR ALL TO river_app
  USING (
    instance_id = (SELECT river.current_instance_id())
    AND EXISTS (
      SELECT 1 FROM river.circles c
       WHERE c.id = circle_id
         AND c.instance_id = (SELECT river.current_instance_id())
         AND c.account_id = (SELECT river.current_account_id())
    )
  )
  WITH CHECK (
    instance_id = (SELECT river.current_instance_id())
    AND EXISTS (
      SELECT 1 FROM river.circles c
       WHERE c.id = circle_id
         AND c.instance_id = (SELECT river.current_instance_id())
         AND c.account_id = (SELECT river.current_account_id())
    )
  );
GRANT SELECT, INSERT, DELETE ON river.circle_members TO river_app;

ALTER TABLE river.read_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.read_state FORCE ROW LEVEL SECURITY;
CREATE POLICY read_state_own ON river.read_state FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON river.read_state TO river_app;

ALTER TABLE river.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE river.preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY preferences_own ON river.preferences FOR ALL TO river_app
  USING (instance_id = (SELECT river.current_instance_id())
         AND account_id = (SELECT river.current_account_id()))
  WITH CHECK (instance_id = (SELECT river.current_instance_id())
              AND account_id = (SELECT river.current_account_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON river.preferences TO river_app;
