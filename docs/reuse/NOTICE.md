# Reused code: origin and permission

These are reference copies. Build threads read them and write the River's own versions under `src/` and `ui/`; nothing here is imported, built, linted or tested (greenfield-starter lint skips `docs/`).

**Permission.** On 2026-10-20 Adam (Founding Steward, Mosaic Foundation) approved reusing this code in the River under AGPL-3.0. The Foundation is moving `civic-hub` and `citizen-dashboard` to AGPL; at the time of copying their LICENSE files still said BUSL-1.1 (Licensor: Mosaic Foundation) and their `package.json` files said MIT. `shared/design-system` was marked UNLICENSED; Mosaic-Social and Mosaic-River declared MIT in `package.json` only. All are Mosaic Foundation projects.

| File here | Origin | Commit | Use in the River |
| --- | --- | --- | --- |
| `civic-hub/ssrfGuard.ts`, `civic-hub/ssrfGuard.test.ts` | Civic-Social-Mono `civic-hub/src/utils/ssrfGuard.ts`, `civic-hub/tests/unit/ssrfGuard.test.ts` | `0f1aab0` | Port as the fetch guard (M2, ADR-001): cap redirects at 3 and bodies at 2 MB, swap the hub's error class and dev flag |
| `civic-hub/http.ts` | `civic-hub/src/utils/http.ts` | `0f1aab0` | Adapt: timeout and JSON helpers over the guard |
| `civic-hub/feedActivity.ts` | `civic-hub/src/shared/feedActivity.ts` | `0f1aab0` | Reference for the closed-by-default allowlist (reads the old v0.1 event shape) |
| `civic-hub/activitySerializer.test.ts` | `civic-hub/tests/unit/activitySerializer.test.ts` | `0f1aab0` | Golden AS2 documents to use as parser fixtures |
| `civic-hub/20260925000000_hub_isolation_policies.sql` | `civic-hub/supabase/migrations/` | `0f1aab0` | Reference for the forced-RLS pattern (the River uses its own roles and settings) |
| `citizen-dashboard/adaptEvents.js`, `adaptEvents.test.js` | `citizen-dashboard/src/services/`, `tests/unit/` | `0f1aab0` | Reference for activity-to-sentence wording (`hubTemplates.ts`) |
| `citizen-dashboard/MobileTabBar.jsx` | `citizen-dashboard/src/components/` | `0f1aab0` | Adapt: four-tab bottom bar |
| `design-system/tokens-american-landscape.css` | `shared/design-system/tokens.css` | `0f1aab0` | Source of `civic.css` (green American Landscape palette) |
| `mosaic-social/index.css` | Mosaic-Social `client/src/index.css` | `1f0cfad` | Source of `mosaic.css` (navy theme, Newsreader and Nunito Sans) |
| `logos/mosaic-logo-large.png`, `mosaic-logo-white-wordmark.png`, `mosaic-favicon.svg` | Mosaic-Social `attached_assets/` | `1f0cfad` | Header logo, dark-background wordmark, favicon |
| `logos/mosaic-logo.svg` | Mosaic-River `client/public/mosaic-logo.svg` | `b23f0b3` | The only vector wordmark found; check it matches the 2026 logo before use |
