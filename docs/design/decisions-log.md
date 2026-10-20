> Background for the River build. Where this log and `docs/spec/river-v1.md` differ, the spec wins.

# Mosaic River Decisions Log

2026-10-19 · Adam

Every design decision for Mosaic River (Stage 1) and the Citizen Dashboard (Stage 2), newest last. Nothing is final until Adam signs off on the phase it belongs to.

## Decisions

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| 1 | Fixed at kickoff | AGPL for everything. Civic Hub stack and conventions (ADR-001, ADR-004 multi-tenant, ADR-006/007), emulated where it makes sense. Must read what the Civic Hub and Representative Space publish today. Specs are guidelines serving the mission; where a different standard or technical choice serves the goals better, take it and list the spec change. | Decided |
| 2 | Scope | Mosaic River is a core component of the Mosaic ecosystem: an individual's decentralized inbox, not civic-specific. The personal news feed is the primary use case. | Decided |
| 3 | Build order | Build the River first and refine it. Then add the Civic mode that becomes the Citizen Dashboard. | Decided |
| 4 | Citizen Dashboard | The Citizen Dashboard is the River's Civic mode (row 23), not a separate app or fork. A civic web address can open the River straight into Civic mode with the Civic theme. | Decided |
| 5 | Data streams | Representatives, ballot and other API-fed data streams are deferred. The Civic mode ships with the panel slot and placeholder plugins. | Decided |
| 6 | Demos | Two demos. Mosaic River: an art-of-the-possible demo linked from mosaic.social. Citizen Dashboard (Civic mode): for the pro-democracy and civic tech community, showing updates from across a person's hubs plus relevant civic information. | Decided |
| 7 | What v1 follows | Mosaic and Civic Spaces, plus public fediverse accounts, read-only. The River reads public accounts directly and has no fediverse address of its own yet; accounts on servers that block unsigned reads wait for the later push model (row 32). | Decided |
| 8 | Reading vs posting | v1 reads only; each item deep-links into its Space. Replying and posting from the River come in a later phase unless they turn out to be cheap. | Decided |
| 9 | atproto | An adapter slot left as a stub, unless it turns out to be easy. | Decided |
| 10 | Identity: front door | Sign up and sign in with a passkey (Face ID, fingerprint or device PIN): no password, no email. Behind the scenes the person gets their own did:webvh, hosted for them at first by a Mosaic-run identity host that holds the signing key (managed custody). The person need never see the DID. The DID is theirs, not Mosaic's: did:webvh carries a self-certifying ID (SCID) and a signed change log, so it can move to another host, or its keys to the person's own wallet, and still be proven to be the same identity. When it moves, the address part changes and the SCID does not. | Decided |
| 11 | Identity host | The service that hosts people's DIDs and keys is a small, separate, replaceable app at id.mosaic.social. Mosaic runs the first one; anyone can run another, and people can leave. Built with @simplewebauthn/server (passkeys) and didwebvh-ts (did:webvh v1.0, portable from the first entry). Keys are Ed25519, encrypted in the database under one master key kept as a server secret; no paid key service, so keys stay exportable. | Decided |
| 12 | One identity, person-owned data | One identity per person across the whole ecosystem. A person's River data (subscriptions, circles, modes, read state, preferences) belongs to them: it is keyed to their identity, not to any instance, and structured as personal-data-store records so it can later move into their own data store. Internally the River files it under an account ID linked to the DID, so a DID move or a new login method never means re-filing data. | Decided |
| 13 | River sign-in (v1) | The River sends the person to id.mosaic.social, they confirm with their passkey, and the identity host returns a short-lived signed note ("this is DID X, for the River, just now") that the River checks against the DID document. Future work: replace this with an OAuth profile modeled on Bluesky's atproto sign-in before any other site relies on it. | Decided |
| 14 | DID address | A person's DID uses a random short code in its path (e.g. `id.mosaic.social:u:k7q2m9`), not a username, so changing a display name never moves the DID. | Decided |
| 15 | Wallet login (later) | Not in v1. Later login method for people who already hold a wallet: an OpenID4VP 1.0 verifier with a QR cross-device flow, identifying itself by x509 and did:web, accepting a membership credential (SD-JWT VC). Candidate libraries: `@openid4vc/openid4vp`, `dcql`, `@sd-jwt/sd-jwt-vc`. Test wallets: Paradym, walt.id, the friend's proof of concept, Keyring. Spec-pass item: demote SIOPv2. LocalPub is not used. | Decided |
| 16 | Credential-gated content | Built as seams in v1, used later. Every River item carries the audience it was published to. The fetch layer takes a per-person authorization context, so a Space can return items gated by membership, residency or age to that person only. Gated items are never cached across people. The linked pages are gated by the Space itself, through DID sign-in and credential checks. | Decided |
| 17 | Hub view | v1 shows each hub's public view. Member and credential-gated views arrive with DID sign-in (rows 13 and 16), which needs its own hub ADR. | Decided |
| 18 | Hosting | A non-production demo, as cheap as possible: Vercel Hobby and free Supabase, no production backups. | Decided |
| 19 | Civic theme | The root `tokens.css` green palette ("American Landscape"), used by the Civic mode on civic web addresses. | Decided |
| 20 | Mosaic theme | The River matches the mosaic.social website's current look: navy, blue and gold on white, Newsreader headings, Nunito Sans body. Both themes share components through the design-system token layers; theming can change later. | Decided |
| 21 | Vocabulary | "Lens" keeps the specs' meaning: a view type such as Inbox or Notifications. "Circles" are groups of sources (row 22). "Modes" are ways of using the River (row 23). | Decided |
| 22 | Circles | Simple and global. A circle is a named group of sources, such as Family, Work, Civic or Soccer; a source can be a person, an organization or a Space, and can be in several circles. Circles exist across all modes, and any mode can use any of them. | Decided |
| 23 | Modes | A mode is a way of using the River. It sets which circles the feed shows by default, which plugins appear and where (such as the right-hand panel), and optionally its own layout and, later, theme. v1 ships two built-in modes: Everything (all sources, no panel) and Civic (the Civic circle plus the panel with placeholder plugins). People making their own modes comes later. Which modes an instance offers, and which opens first, is configuration: a River can ship with only Civic mode and the mode switcher hidden. | Decided |
| 24 | Plugins | The same family as Civic Hub plugins: the same manifest format, the same declare-what-you-need permission model, and named surfaces where a plugin can appear. River plugins are a new tool or view kind (anticipated but not yet specified in the plugin spec), with River surfaces: the side panel, a mode header and a feed-card action. Plugins that declare surfaces in both hosts can run in the hub and the River. v1: first-party plugins bundled at build time, plus one or two simple ones to prove the system (e.g. Upcoming events from feed items). Third-party plugins and sandboxing come later. | Decided |
| 25 | Offering it as a service | One deployment serves many people cheaply: serverless, free tiers, and public feed items fetched once and shared by everyone who follows that source. Following ADR-004 where it fits, the data model includes an instance concept chosen by web address, holding branding and defaults (name, theme, default modes, seed sources, plugins) as data, so organizational Rivers stay possible later. Only river.mosaic.social is live in v1; a super-admin screen comes later. | Decided |
| 26 | First visit | A demo visitor lands on a River already filled: real Civic Hubs (Demosville, Floyd, Longmont), a few fediverse accounts, and sample entries for other audiences (row 33). Seeds can be removed later. | Decided |
| 27 | Adding a source | One box accepts a URL or a handle. A hub URL follows the whole hub; a process URL follows only that process; a profile URL or `@name@server` follows a fediverse account. A list shows every subscription. | Decided |
| 28 | Follow and mute | Follow or mute at any level: a hub, a process inside it, an account. The most specific rule wins, so you can mute one process in a hub you follow, or follow one process in a hub you don't. | Decided |
| 29 | One River, follow links | Assume one River per person for now. The River accepts a follow link (a URL that opens the River with a source filled in) as a stub. Follow buttons on Mosaic Spaces come later. | Decided |
| 30 | Discovery | Out of v1. | Decided |
| 31 | Portability | Designed in from the start: person-owned data (row 12) in a standardized, exportable format. The export and import screens come in a later milestone. | Decided |
| 32 | Getting updates | v1 pulls. The River asks each followed source for its feed (the hub's `/events` with a since-cursor; a fediverse account's outbox) when a person opens or refreshes, with a short shared cache for public items. Push comes later: the River gets its own ActivityPub actor and sources deliver to its inbox (Level 2 in the activity spec). | Decided |
| 33 | Sample entries | Sample feed entries (stored in the River's own data, not real feeds) show other audiences: a family, a soccer club, a publisher, a neighborhood association, an issue campaign. Each carries a "Sample" label; clicking it explains "This isn't linked to a real feed; it's here to show how the River works." Items from real sources carry a "Live" label. | Decided |
| 34 | Seed fediverse accounts | New Public, W3C, EFF, Internet Archive, Wikipedia and the Social Web Foundation, all verified active and readable on 2026-10-19. We Distribute is left out. | Decided |
| 35 | Repo | One new repo, `Mosaic-Foundation/river` (if the name is free in the org), outside Civic-Social-Mono, holding two deployable apps: the River and the identity host. Design-system files are copied in. The existing citizen-dashboard stays running until the Civic mode replaces it. | Decided |
| 36 | Database | One free Supabase project in the Mosaic Dev org, shared by the River and the identity host. Free orgs allow two active projects, so the Representative Space dev project or the old Civic Hub demo gets paused or removed when the build starts. Adam does this. | Decided |
| 37 | Domains | `river.mosaic.social` for the River and `id.mosaic.social` for the identity host. Adam controls both. Passkeys and the first DID addresses are tied to these. | Decided |
| 38 | Hub changes (later) | Small Civic Hub changes for later, outside the River build: let any site read the public `/events` feed and `civic.json` without credentials; an optional "Follow in my River" button; DID sign-in for member views; the Representative Space moving to the v0.2 feed format. | Proposed |

**Added after the first mockups (2026-10-19)**

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| 39 | Words | Follow (verb), Following (the management page), Spaces (a hub, publication, club or person's account) and Streams (one followable part of a space: a process, an event calendar, a section). Streams merge into rivers. These replace "source" and "subscription" in the UI. | Decided |
| 40 | Left panel | Filters, not a list of everything followed: search, circles, and kinds (automatic groups such as Civic Hubs, Mastodon, Publications, Clubs, Samples) with counts. Individual spaces show only when a kind is expanded, in a short searchable list. | Decided |
| 41 | Categories | Every followed space gets a category automatically: Mosaic spaces from the type their manifest declares, fediverse accounts from their network and actor type. People can override. Modes use categories for defaults: Civic mode shows everything categorized civic plus the Civic circle. | Decided |
| 42 | Content-type filter | Chips for Posts, Articles, Podcasts, Videos, Photos, Events and Civic activity, combined with the selected circle and mode. The demo shows it with sample podcast, video and photo entries. | Decided |
| 43 | Following stays tidy | The Following page groups by space and stays collapsed. A followed stream ends when its process ends: its final result lands in the person's River and stays in their record, then the stream drops off the Following list into a hidden Ended list. Spaces with nothing new for about 90 days go into a Quiet section, and the River offers to prune them in one click. | Decided |
| 44 | Hub icons | Add an `icon` field to the Civic Hub's `civic.json` (hub change plus a one-line spec addition). With no icon, show the place's initials. Fediverse accounts use their own avatars. | Decided |
| 45 | Images (v1) | Post images load straight from the source, lazily, with no spinners; an image that fails to load is simply left out. No content-warning blur. Link previews come later (the Mastodon API's ready-made ones can be used when reading through it). | Decided |
| 46 | Card styling | Clean cards; types told apart by the source icon, a small kind label and pictures, not heavy borders. | Decided |
| 47 | Images (long term) | Proposed: a thumbnail proxy. The River serves small, resized copies of only the images people see in the feed, cached at the CDN edge and not stored permanently; full-size images open from the source. This protects readers' privacy at a small, view-proportional cost. To be confirmed in its own ADR. | Proposed |

**Layout direction after the second mockups (2026-10-19):** the left column should hold all filtering: search across followed spaces, circles, and content type (as chips or a dropdown). "Kinds" is not settled: Mastodon as a network-level group makes sense; Samples should not appear there. A personal identity element on the River (whose River this is) is deferred. Playing podcasts and videos inline is wanted, and real media sources may be seeded later. The layout is expected to change once the River is in use; the mockups are a starting point, not a fixed design.

## Open questions for Phase 1

- [x] **First visit.** Does a demo visitor see a River already filled with sample subscriptions before signing in, or sign in first and start empty?
- [x] **Seed sources.** Which hubs and accounts fill the demo? Floyd is in private beta, so click-throughs hit a sign-in gate. Demosville, Longmont and Athens are demo hubs. The Representative Space has emitted nothing since 2026-07-15.
- [x] **Adding a source.** Paste a hub URL or a fediverse handle (`@name@server`), pick from a list of suggested Spaces, or both?
- [x] **Showing portability.** Should the demo let people export and re-import their subscriptions as a file, to show they own them?
- [x] **Organizing.** Are circles and saved modes in v1, or only one chronological feed plus simple filters?
- [ ] **Cheap replies.** For fediverse items, a "reply from your own account" link may cost little compared with posting from the River. Not yet checked.
- [ ] **Similar projects to review.** Hypha's [Social Reader](https://hypha.coop/dripline/social-reader-is-out/), Flipboard's [Surf](https://www.niemanlab.org/reading/flipboard-launches-surf-its-new-social-app-and-feed-reader/), and The Open Co-op's Feeds. We Distribute is waiting on a link from Adam.

**Sign-in questions for Phase 2**

- [x] **Which spec version.** The page Adam's friend linked is draft 18 (April 2023). OpenID4VP 1.0 was released by July 2025 ([MATTR, 2025-07-30](https://mattr.global/article/oid4vp-1-0-is-here-unlocking-a-new-era-of-verifiable-credentials)). The EWC wallet RFC targets draft 23 ([EWC RFC002](https://github.com/EWC-consortium/eudi-wallet-rfcs/blob/main/ewc-rfc002-present-verifiable-credentials.md)). Target 1.0 unless the wallets we test with need an older draft.
- [x] **What the wallet presents.** OpenID4VP presents credentials; it has no plain "prove you control this DID" login. Draft 18 pairs it with SIOPv2 for that. We need to choose what the River asks for: an ID token through SIOPv2, any credential bound to the holder's key, or a membership credential the River issues at sign-up.
- [x] **Credential format.** EU wallets center on SD-JWT VC and mdoc. W3C VCs are also in scope. Which the River accepts decides which wallets work.

- [ ] **DID methods the River can check.** The identifier check goes behind a pluggable resolver: `did:key` for the demo identity, then `did:web` and `did:webvh` (the identity spec's preferred method). Adam's friend reports that a `did:scid:vh` ID can only be checked against its log, and that adding `?src=<log URL>` (one or more URLs, e.g. on civic.social) makes it behave like `did:webvh`. He has studied it for a couple of weeks and is unsure how others use it, so treat this as unverified.

## Changes from the spec review (2026-10-20)

The engineering review of the v1 spec changed four decisions recorded above; the spec (draft 2) is now the reference for each.

- **Database access**: both apps connect with `pg` through the Supabase pooler as two LOGIN roles (`river_app`, `identity_app`) with RLS set per request, not through Supabase API keys.
- **Scheduled work**: one daily pg_cron job handles retention, ended follows, expired sign-in rows and sample dates. Feeds still refresh on open.
- **Sign-in**: v1 accepts only DIDs hosted at id.mosaic.social (`TRUSTED_DID_HOSTS`).
- **Ended streams**: a stream stays readable 7 days after its process ends so results still arrive; the final result is kept past the 90-day cleanup.

Adam's answers, 2026-10-20:

- **Hosting**: Vercel Hobby and free Supabase for now (non-commercial early development); paid plans when the River is shared widely.
- **Recovery**: a lost passkey must not lose the account. The identity host requires an email address at sign-up and offers email recovery that adds a new passkey to the same DID. Key-custodian or social recovery may replace it later.
- **Later idea**: link a person's Mastodon account in settings so replies from the River come from that account.
- **DID method**: did:webvh only. did:scid is not used.

Build hand-off decisions, 2026-10-20 (approved by Adam with the hand-off):

- **Repo layout**: the greenfield template's single-codebase layout, with one codebase deployed as two Vercel projects (`river` and `river-identity`) chosen by `APP`. This replaces the spec's earlier npm-workspaces plan.
- **No vendored design system**: the River uses its own `mosaic.css` and `civic.css` themes; the template's vendoring step is skipped.
- **Before DNS**: sign-in runs on the vercel.app hosts with test accounts, deleted at the move to id.mosaic.social.
- **Licensing**: the Foundation is moving civic-hub and citizen-dashboard to AGPL, and Adam approved reusing their code in the River now (2026-10-20); the docs PR records this in docs/reuse/NOTICE.md.

- **Recovery update key** (Adam, 2026-10-20): every DID lists a second update key, the Mosaic recovery key, kept offline by Adam. If the master key is lost, he re-keys the DIDs with it and people keep their DID, account, passkeys and email.
