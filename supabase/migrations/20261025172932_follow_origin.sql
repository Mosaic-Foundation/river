-- Where each follow came from (Adam, 2026-10-25): the follow box or a stream rule ('manual'), the
-- instance's seed copy at sign-up ('seed'), "Import from Bluesky" ('bluesky_import', with the
-- imported account in origin_ref and its handle at the time in origin_label), and later a linked
-- account ('linked'). Rows from before this migration are 'unknown'. An import can then offer to
-- unfollow only the accounts it added from that same Bluesky account (DECISIONS.md).
--
-- Additive only: two new nullable text columns and one NOT NULL column with a constant default
-- (no table rewrite), each with a CHECK. The table's row-level security policy (follows_own) and
-- its grants cover new columns as they are; nothing else changes.
--
-- Code runs against the previous schema too (CLAUDE.md "Database"): it looks for the origin
-- column first (src/river/following/origin.ts) and leaves the columns out until it exists.
ALTER TABLE river.follows
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS origin_ref text,
  ADD COLUMN IF NOT EXISTS origin_label text;

ALTER TABLE river.follows DROP CONSTRAINT IF EXISTS follows_origin_check;
ALTER TABLE river.follows ADD CONSTRAINT follows_origin_check
  CHECK (origin IN ('unknown', 'manual', 'seed', 'bluesky_import', 'linked'));

-- A Bluesky import names the account it came from (a DID); nothing else carries a reference yet.
ALTER TABLE river.follows DROP CONSTRAINT IF EXISTS follows_origin_ref_check;
ALTER TABLE river.follows ADD CONSTRAINT follows_origin_ref_check
  CHECK ((origin_ref IS NULL OR length(origin_ref) <= 300)
         AND (origin_label IS NULL OR length(origin_label) <= 300)
         AND (origin <> 'bluesky_import' OR origin_ref IS NOT NULL));

COMMENT ON COLUMN river.follows.origin IS
  'Where the follow came from: manual, seed, bluesky_import, linked, or unknown (before 2026-10-25).';
COMMENT ON COLUMN river.follows.origin_ref IS
  'For bluesky_import: the DID of the Bluesky account whose follows were imported.';
COMMENT ON COLUMN river.follows.origin_label IS
  'For bluesky_import: that account''s handle when it was imported, for display.';
