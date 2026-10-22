-- M12: the feed adapter (RSS, Atom and podcast feeds; ADR-007) stores its spaces with
-- adapter = 'rss'. This widens river.spaces' adapter CHECK by that one value; every existing row
-- already satisfies it, nothing else about the table, its policies or its grants changes.
--
-- Code runs against the previous schema too (CLAUDE.md "Database"): until this lands, storing an
-- rss space fails this CHECK and the follow box answers "That kind of Space isn't supported yet"
-- (src/river/feed/store.ts upsertSpace).
ALTER TABLE river.spaces DROP CONSTRAINT IF EXISTS spaces_adapter_check;
ALTER TABLE river.spaces ADD CONSTRAINT spaces_adapter_check
  CHECK (adapter IN ('civic_hub', 'fediverse', 'sample', 'rep_space_v01', 'atproto', 'rss'));
