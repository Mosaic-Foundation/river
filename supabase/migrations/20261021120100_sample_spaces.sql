-- M5: the sample spaces (spec 4.4) and their place in the seed instance's lists (Appendix D).
--
-- Data rows only, written here (not in supabase/seed.sql) so the hosted project gets them too. No
-- network: every sample is text in this file, and its images are placeholders in the UI's own
-- public folder (ui/public/samples/), referenced by same-origin paths.
--
-- Each sample space's canonical_url is a URN, urn:mosaic:sample:{slug}: unique, and not a URL any
-- adapter accepts or the fetch guard would fetch (https only), so a sample can never be resolved
-- or refreshed. Sample items have no url (no "Open on" link), keep their age in raw.sample.age
-- (and an event's start in raw.sample.startsIn), and are dated by river.restamp_samples(), here
-- and every day by river.daily_job(). Retention and Quiet skip them (adapter = 'sample').

INSERT INTO river.spaces (adapter, canonical_url, name, category, manifest, fetch_status) VALUES
  ('sample', 'urn:mosaic:sample:riverside-rovers', 'Riverside Rovers Soccer Club', 'club',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:okafor-family', 'The Okafor Family', 'family',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:millbrook-ledger', 'The Millbrook Ledger', 'publication',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:elm-street-neighbors', 'Elm Street Neighbors', 'neighborhood',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:safe-streets-millbrook', 'Safe Streets for Millbrook', 'organization',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:small-town-signals', 'Small Town Signals', 'podcast',
   '{"sample": true}', 'ok'),
  ('sample', 'urn:mosaic:sample:trailhead-tv', 'Trailhead TV', 'video',
   '{"sample": true}', 'ok')
ON CONFLICT (canonical_url) DO NOTHING;

INSERT INTO river.items (
  space_id, source_id, kind, published_at, title, summary, content_html, url, author, media, raw
)
SELECT s.id, v.source_id, v.kind, now(), v.title, v.summary, v.content_html, NULL,
       jsonb_build_object('name', s.name), v.media::jsonb, v.raw::jsonb
  FROM (VALUES
    -- Soccer club
    ('urn:mosaic:sample:riverside-rovers', 'urn:mosaic:sample:riverside-rovers:1', 'post',
     NULL, NULL,
     '<p>Saturday''s under-10 match has moved to Field 3. Kickoff is still 9:30. Bring water and sunscreen; it will be warm.</p>',
     '[]', '{"sample": {"age": "2 hours"}}'),
    ('urn:mosaic:sample:riverside-rovers', 'urn:mosaic:sample:riverside-rovers:2', 'photo',
     NULL, NULL,
     '<p>Season wrap-up: thank you, families, for every carpool and orange slice.</p>',
     '[{"type": "image", "url": "/samples/soccer-team.svg", "alt": "Drawing of a soccer team lined up on a green field with a goal behind them", "width": 800, "height": 500}]',
     '{"sample": {"age": "1 day 3 hours"}}'),
    -- Family circle (photos)
    ('urn:mosaic:sample:okafor-family', 'urn:mosaic:sample:okafor-family:1', 'photo',
     NULL, NULL,
     '<p>Grandma Ada''s 80th in the garden. She beat everyone at cards again.</p>',
     '[{"type": "image", "url": "/samples/family-garden.svg", "alt": "Drawing of a birthday table in a garden with a cake and string lights", "width": 800, "height": 500}]',
     '{"sample": {"age": "5 hours"}}'),
    ('urn:mosaic:sample:okafor-family', 'urn:mosaic:sample:okafor-family:2', 'photo',
     NULL, NULL,
     '<p>First swim of the summer at the lake.</p>',
     '[{"type": "image", "url": "/samples/family-lake.svg", "alt": "Drawing of a lake with a wooden dock and pine trees on the far shore", "width": 800, "height": 500}]',
     '{"sample": {"age": "3 days 2 hours"}}'),
    -- Local publication
    ('urn:mosaic:sample:millbrook-ledger', 'urn:mosaic:sample:millbrook-ledger:1', 'article',
     'Library extends weekend hours through the winter',
     'The Millbrook Public Library will open on Sundays from noon to five starting next month.',
     '<p>The Millbrook Public Library will open on Sundays from noon to five starting next month, after a volunteer drive covered the extra staffing.</p><p>The children''s room and the computer lab will be open during the new hours.</p>',
     '[{"type": "image", "url": "/samples/ledger-library.svg", "alt": "Drawing of a brick library building with tall windows", "width": 800, "height": 500}]',
     '{"sample": {"age": "4 hours"}}'),
    ('urn:mosaic:sample:millbrook-ledger', 'urn:mosaic:sample:millbrook-ledger:2', 'article',
     'Footbridge over Mill Creek reopens after repairs',
     'Walkers and cyclists can cross Mill Creek at Second Street again.',
     '<p>Walkers and cyclists can cross Mill Creek at Second Street again. Crews replaced the deck boards and railings over six weeks.</p>',
     '[]', '{"sample": {"age": "2 days 6 hours"}}'),
    -- Neighborhood association (an event)
    ('urn:mosaic:sample:elm-street-neighbors', 'urn:mosaic:sample:elm-street-neighbors:1', 'event',
     'Fall cleanup day',
     'Rakes, gloves and coffee provided. Meet at the corner of Elm and Fourth.',
     '<p>Rakes, gloves and coffee provided. Meet at the corner of Elm and Fourth. All ages welcome.</p>',
     '[{"type": "image", "url": "/samples/cleanup-day.svg", "alt": "Drawing of autumn trees and a pile of raked leaves on a sidewalk", "width": 800, "height": 500}]',
     '{"type": "Event", "location": {"name": "Elm Street and Fourth Avenue"}, "sample": {"age": "1 day", "startsIn": "5 days 2 hours"}}'),
    ('urn:mosaic:sample:elm-street-neighbors', 'urn:mosaic:sample:elm-street-neighbors:2', 'post',
     NULL, NULL,
     '<p>The streetlight at Elm and Sixth is fixed. Thanks to everyone who reported it.</p>',
     '[]', '{"sample": {"age": "4 days"}}'),
    -- Issue campaign
    ('urn:mosaic:sample:safe-streets-millbrook', 'urn:mosaic:sample:safe-streets-millbrook:1', 'post',
     NULL, NULL,
     '<p>412 neighbors have signed for a crosswalk at Main and Second. We deliver the petition to the town council on Tuesday.</p>',
     '[]', '{"sample": {"age": "6 hours"}}'),
    -- Podcast: one episode, with a duration; the cover image stands in for the audio. Check 5
    -- expects exactly one podcast item in News and ideas.
    ('urn:mosaic:sample:small-town-signals', 'urn:mosaic:sample:small-town-signals:1', 'podcast',
     'Episode 41: How a town budget gets made',
     'The finance director walks through a year of budget meetings, from first draft to final vote.',
     '<p>The finance director walks through a year of budget meetings, from first draft to final vote.</p>',
     '[{"type": "image", "url": "/samples/podcast-cover.svg", "alt": "Podcast cover art: a radio tower drawn in two colors", "width": 600, "height": 600, "duration": 2280}]',
     '{"sample": {"age": "8 hours"}}'),
    -- Video channel (a duration)
    ('urn:mosaic:sample:trailhead-tv', 'urn:mosaic:sample:trailhead-tv:1', 'video',
     'Ridge loop in twelve minutes',
     'A short walk-through of the ridge loop trail, with the tricky turns marked.',
     '<p>A short walk-through of the ridge loop trail, with the tricky turns marked.</p>',
     '[{"type": "image", "url": "/samples/video-trail.svg", "alt": "Video still: a dirt trail winding up a hill under a wide sky", "width": 800, "height": 450, "duration": 754}]',
     '{"sample": {"age": "1 day 9 hours"}}'),
    ('urn:mosaic:sample:trailhead-tv', 'urn:mosaic:sample:trailhead-tv:2', 'video',
     'Packing a day bag',
     'What goes in, what stays home, and why.',
     '<p>What goes in, what stays home, and why.</p>',
     '[{"type": "image", "url": "/samples/video-trail.svg", "alt": "Video still: a dirt trail winding up a hill under a wide sky", "width": 800, "height": 450, "duration": 431}]',
     '{"sample": {"age": "5 days 1 hour"}}')
  ) AS v(space_url, source_id, kind, title, summary, content_html, media, raw)
  JOIN river.spaces s ON s.canonical_url = v.space_url
ON CONFLICT (space_id, source_id) DO NOTHING;

SELECT river.restamp_samples(now());

-- The seed instance follows every sample and lists them in its default circles (Appendix D):
-- Family, Soccer and Neighborhood get the matching samples; News and ideas gets the publication
-- and the podcast. The campaign and the video channel are followed but in no circle. Each follow's
-- circles are exactly the circles that list it (tests/api/db/catalog.test.ts checks).
UPDATE river.instances
   SET seed_follows = seed_follows || '[
         {"url": "urn:mosaic:sample:riverside-rovers", "circles": ["Soccer"]},
         {"url": "urn:mosaic:sample:okafor-family", "circles": ["Family"]},
         {"url": "urn:mosaic:sample:millbrook-ledger", "circles": ["News and ideas"]},
         {"url": "urn:mosaic:sample:elm-street-neighbors", "circles": ["Neighborhood"]},
         {"url": "urn:mosaic:sample:safe-streets-millbrook", "circles": []},
         {"url": "urn:mosaic:sample:small-town-signals", "circles": ["News and ideas"]},
         {"url": "urn:mosaic:sample:trailhead-tv", "circles": []}
       ]'::jsonb,
       default_circles = (
         SELECT jsonb_agg(
                  CASE c ->> 'name'
                    WHEN 'News and ideas' THEN jsonb_set(c, '{members}', (c -> 'members') ||
                      '["urn:mosaic:sample:millbrook-ledger", "urn:mosaic:sample:small-town-signals"]'::jsonb)
                    WHEN 'Family' THEN jsonb_set(c, '{members}', (c -> 'members') ||
                      '["urn:mosaic:sample:okafor-family"]'::jsonb)
                    WHEN 'Soccer' THEN jsonb_set(c, '{members}', (c -> 'members') ||
                      '["urn:mosaic:sample:riverside-rovers"]'::jsonb)
                    WHEN 'Neighborhood' THEN jsonb_set(c, '{members}', (c -> 'members') ||
                      '["urn:mosaic:sample:elm-street-neighbors"]'::jsonb)
                    ELSE c
                  END
                  ORDER BY ord)
           FROM jsonb_array_elements(default_circles) WITH ORDINALITY AS t(c, ord)
       )
 WHERE id = '00000000-0000-4000-8000-000000000001'
   AND NOT seed_follows @> '[{"url": "urn:mosaic:sample:riverside-rovers"}]';
