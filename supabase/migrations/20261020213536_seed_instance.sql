-- M1: the seed instance, river.mosaic.social (spec 2 "Operator", Appendix D "Seeds").
--
-- The id is fixed so code, seeds and tests can name the seed instance without a lookup; the
-- hostnames in INSTANCE_HOST_ALIASES resolve to this row too (ADR-004).
--
-- seed_follows and default_circles name spaces by what a person would type in the follow box (a
-- hub URL or @name@server). The spaces themselves are created when the River first resolves them
-- (M3, M4). The sample spaces (spec 4.4) arrive with their seed in M5, which adds them to Family,
-- Soccer, Neighborhood and News and ideas; until then those circles list only real sources.
-- Plugins are configured in M10.
INSERT INTO river.instances (
  id, hostname, name, theme, modes_enabled, default_mode, seed_follows, default_circles, plugins
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'river.mosaic.social',
  'Mosaic River',
  'mosaic',
  ARRAY['everything', 'civic'],
  'everything',
  '[
    {"url": "https://demosville.civic.social", "circles": ["Civic"]},
    {"url": "https://floyd.civic.social", "circles": ["Civic"]},
    {"url": "https://longmont.civic.social", "circles": ["Civic"]},
    {"url": "@wearenew_public@mastodon.social", "circles": ["News and ideas"]},
    {"url": "@w3c@w3c.social", "circles": ["News and ideas"]},
    {"url": "@eff@mastodon.social", "circles": ["News and ideas"]},
    {"url": "@internetarchive@mastodon.archive.org", "circles": ["News and ideas"]},
    {"url": "@wikipedia@wikis.world", "circles": ["News and ideas"]},
    {"url": "@swf@socialwebfoundation.org", "circles": ["News and ideas"]}
  ]',
  '[
    {"name": "Civic", "color": "#2F6FA8", "role": "civic", "members": [
      "https://demosville.civic.social",
      "https://floyd.civic.social",
      "https://longmont.civic.social"
    ]},
    {"name": "News and ideas", "color": "#7A5AA6", "members": [
      "@wearenew_public@mastodon.social",
      "@w3c@w3c.social",
      "@eff@mastodon.social",
      "@internetarchive@mastodon.archive.org",
      "@wikipedia@wikis.world",
      "@swf@socialwebfoundation.org"
    ]},
    {"name": "Family", "color": "#C2603A", "members": []},
    {"name": "Soccer", "color": "#3C8A4E", "members": []},
    {"name": "Neighborhood", "color": "#A8862C", "members": []}
  ]',
  '[]'
)
ON CONFLICT (hostname) DO NOTHING;
