// SYNTHETIC fixtures for M12 (a PeerTube channel and a podcast feed). They are NOT recordings:
// the M12 thread's sandbox could not reach any PeerTube instance or podcast host (its egress
// proxy refused them), so instead of guessing at a real site's content these responses are
// written by hand to the published formats, on hosts under the reserved `.example` TLD
// (RFC 2606) that can never be real:
//
// - synthetic-tube.example: a PeerTube 7 channel as PeerTube's ActivityPub serializers emit it
//   (WebFinger, NodeInfo 2.0, the Group actor, the outbox whose items are Announces of the
//   channel's own videos, and each Video object with `duration` as xsd:duration, thumbnails in
//   `icon`, files and the HLS playlist in `url`, the description as Markdown);
// - synthetic-podcast.example: an RSS 2.0 podcast feed with Apple's podcast namespace
//   (`itunes:duration`, `itunes:image`, `<enclosure>`), `content:encoded`, an HTML home page that
//   names the feed with <link rel="alternate" type="application/rss+xml">, and the 304 the feed
//   answers to its own ETag.
//
// Both hosts also answer /.well-known/civic.json with 404, as any non-hub host does, because the
// follow box asks the Civic Hub adapter first.
//
// Regenerate with `npx tsx scripts/synthetic-media-fixtures.ts` (it rewrites only the two
// synthetic-* folders). Replace them with recordings (`npm run record-fixtures -- --media <url>`)
// once real sources are chosen and reachable.
import fs from "node:fs";
import path from "node:path";
import { saveFixture, type HttpFixture } from "../src/shared/fetch/index.js";

const OUT_DIR = "tests/fixtures/http";
const NOTE = "SYNTHETIC: written by scripts/synthetic-media-fixtures.ts to the published format; not a recording.";

const TUBE = "synthetic-tube.example";
const PODCAST = "synthetic-podcast.example";

function save(fixture: HttpFixture): string {
  return saveFixture(OUT_DIR, { ...fixture, note: NOTE } as HttpFixture);
}

const AP_HEADERS = { "content-type": "application/activity+json; charset=utf-8", vary: "Accept" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function json(url: string, body: unknown, headers: Record<string, string> = AP_HEADERS): HttpFixture {
  return { url, status: 200, headers, body: JSON.stringify(body) };
}

function notHub(host: string): HttpFixture {
  return {
    url: `https://${host}/.well-known/civic.json`,
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: "<!doctype html><title>Not found</title><h1>Not found</h1>",
  };
}

// ---------------------------------------------------------------------------------------------
// PeerTube channel: @trail_films@synthetic-tube.example
// ---------------------------------------------------------------------------------------------

const T = `https://${TUBE}`;
const CHANNEL = `${T}/video-channels/trail_films`;
const ACCOUNT = `${T}/accounts/rowan`;

const AP_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  {
    RsaSignature2017: "https://w3id.org/security#RsaSignature2017",
    pt: "https://joinpeertube.org/ns#",
    sc: "http://schema.org/",
    playlists: { "@id": "pt:playlists", "@type": "@id" },
    support: { "@type": "sc:Text", "@id": "pt:support" },
    icons: "as:icon",
  },
];

const VIDEO_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  {
    RsaSignature2017: "https://w3id.org/security#RsaSignature2017",
    pt: "https://joinpeertube.org/ns#",
    sc: "http://schema.org/",
    Hashtag: "as:Hashtag",
    uuid: "sc:identifier",
    category: "sc:category",
    licence: "sc:license",
    subtitleLanguage: "sc:subtitleLanguage",
    sensitive: "as:sensitive",
    language: "sc:inLanguage",
    isLiveBroadcast: "sc:isLiveBroadcast",
    views: { "@type": "sc:Number", "@id": "pt:views" },
    state: { "@type": "sc:Number", "@id": "pt:state" },
    size: { "@type": "sc:Number", "@id": "pt:size" },
    fps: { "@type": "sc:Number", "@id": "pt:fps" },
    commentsEnabled: { "@type": "sc:Boolean", "@id": "pt:commentsEnabled" },
    downloadEnabled: { "@type": "sc:Boolean", "@id": "pt:downloadEnabled" },
    waitTranscoding: { "@type": "sc:Boolean", "@id": "pt:waitTranscoding" },
    support: { "@type": "sc:Text", "@id": "pt:support" },
    likes: { "@id": "as:likes", "@type": "@id" },
    dislikes: { "@id": "as:dislikes", "@type": "@id" },
    shares: { "@id": "as:shares", "@type": "@id" },
    comments: { "@id": "as:comments", "@type": "@id" },
  },
];

interface SyntheticVideo {
  uuid: string;
  shortUuid: string;
  name: string;
  /** Seconds; PeerTube writes `PT{seconds}S`. */
  seconds: number;
  published: string;
  description: string;
  /** False: HLS only (no plain web-video file at the top of `url`). */
  webVideo: boolean;
}

const VIDEOS: SyntheticVideo[] = [
  {
    uuid: "5f0c2a8e-3b7d-4c1e-9a62-1d4e8b7f0a31",
    shortUuid: "cXqH7r2Lw9TzP4mV1nBk3s",
    name: "Ridge line at dawn",
    seconds: 273,
    published: "2026-10-19T15:00:00.000Z",
    description: "A slow climb to the east ridge before sunrise.\n\nFilmed on a **handheld** camera; no drones.",
    webVideo: true,
  },
  {
    uuid: "8a41d6f2-0c9b-4e57-b3a8-6f2e1c9d4b72",
    shortUuid: "fJ2nW8sQe5RyK1aD7vLc6m",
    name: "Creek crossing after the storm",
    seconds: 725,
    published: "2026-10-16T18:30:00.000Z",
    description: "The creek was twice its usual width. We waited for the water to drop.",
    webVideo: false,
  },
  {
    uuid: "c3e9b710-6d2a-4f85-8e14-2b7a9d0c5e63",
    shortUuid: "tP9kZ3xVb6NmH2wQ8eRj4a",
    name: "Trail maintenance day",
    seconds: 3723,
    published: "2026-10-11T09:15:00.000Z",
    description: "Volunteers rebuilt three switchbacks. Thanks to everyone who came.",
    webVideo: true,
  },
];

function videoUrl(v: SyntheticVideo): string {
  return `${T}/videos/watch/${v.uuid}`;
}

function videoObject(v: SyntheticVideo) {
  const hls = `${T}/static/streaming-playlists/hls/${v.uuid}`;
  const files = [
    { type: "Link", mediaType: "video/mp4", href: `${T}/static/web-videos/${v.uuid}-720.mp4`, height: 720, width: 1280, size: 48213504, fps: 30 },
    { type: "Link", rel: ["metadata", "video/mp4"], mediaType: "application/json", href: `${T}/api/v1/videos/${v.uuid}/metadata/41`, height: 720, width: 1280, fps: 30 },
    { type: "Link", mediaType: "application/x-bittorrent", href: `${T}/lazy-static/torrents/${v.uuid}-720.torrent`, height: 720, width: 1280, fps: 30 },
  ];
  return {
    "@context": VIDEO_CONTEXT,
    to: [PUBLIC],
    cc: [`${CHANNEL}/followers`],
    type: "Video",
    id: videoUrl(v),
    name: v.name,
    duration: `PT${v.seconds}S`,
    uuid: v.uuid,
    category: { identifier: "6", name: "Travels" },
    licence: { identifier: "1", name: "Attribution" },
    language: { identifier: "en", name: "English" },
    views: 42,
    sensitive: false,
    waitTranscoding: true,
    state: 1,
    commentsEnabled: true,
    downloadEnabled: true,
    published: v.published,
    originallyPublishedAt: null,
    updated: v.published,
    tag: [{ type: "Hashtag", name: "hiking" }],
    mediaType: "text/markdown",
    content: v.description,
    support: null,
    subtitleLanguage: [],
    icon: [
      { type: "Image", url: `${T}/lazy-static/thumbnails/${v.uuid}.jpg`, mediaType: "image/jpeg", width: 280, height: 157 },
      { type: "Image", url: `${T}/lazy-static/previews/${v.uuid}.jpg`, mediaType: "image/jpeg", width: 850, height: 480 },
    ],
    url: [
      { type: "Link", mediaType: "text/html", href: `${T}/w/${v.shortUuid}` },
      {
        type: "Link",
        mediaType: "application/x-mpegURL",
        href: `${hls}/master.m3u8`,
        tag: [
          { type: "Infohash", name: "0c7bd0f6b9ea4b3e8c5f5e7a1d2c3b4a59687766" },
          { type: "Link", name: "sha256", mediaType: "application/json", href: `${hls}/segments-sha256.json` },
          { type: "Link", mediaType: "video/mp4", href: `${hls}/${v.uuid}-720-fragmented.mp4`, height: 720, width: 1280, size: 47185920, fps: 30 },
        ],
      },
      ...(v.webVideo ? files : []),
    ],
    likes: `${videoUrl(v)}/likes`,
    dislikes: `${videoUrl(v)}/dislikes`,
    shares: `${videoUrl(v)}/announces`,
    comments: `${videoUrl(v)}/comments`,
    hasParts: `${videoUrl(v)}/chapters`,
    attributedTo: [
      { type: "Person", id: ACCOUNT },
      { type: "Group", id: CHANNEL },
    ],
    isLiveBroadcast: false,
    liveSaveReplay: null,
    permanentLive: null,
    latencyMode: null,
  };
}

function tubeFixtures(): HttpFixture[] {
  const outbox = `${CHANNEL}/outbox`;
  return [
    notHub(TUBE),
    json(
      `${T}/.well-known/webfinger?resource=acct:trail_films@${TUBE}`,
      {
        subject: `acct:trail_films@${TUBE}`,
        aliases: [CHANNEL],
        links: [
          { rel: "self", type: "application/activity+json", href: CHANNEL },
          { rel: "http://ostatus.org/schema/1.0/subscribe", template: `${T}/remote-interaction?uri={uri}` },
        ],
      },
      { "content-type": "application/jrd+json; charset=utf-8" },
    ),
    json(
      `${T}/.well-known/nodeinfo`,
      { links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: `${T}/nodeinfo/2.0.json` }] },
      JSON_HEADERS,
    ),
    json(
      `${T}/nodeinfo/2.0.json`,
      {
        version: "2.0",
        software: { name: "peertube", version: "7.3.0" },
        protocols: ["activitypub"],
        services: { inbound: [], outbound: ["atom1.0", "rss2.0"] },
        openRegistrations: false,
        usage: { users: { total: 3, activeMonth: 2, activeHalfyear: 3 }, localPosts: 3, localComments: 0 },
        metadata: { nodeName: "Synthetic Tube", nodeDescription: "A synthetic PeerTube instance for tests." },
      },
      JSON_HEADERS,
    ),
    json(CHANNEL, {
      "@context": AP_CONTEXT,
      type: "Group",
      id: CHANNEL,
      following: `${CHANNEL}/following`,
      followers: `${CHANNEL}/followers`,
      playlists: `${CHANNEL}/playlists`,
      inbox: `${CHANNEL}/inbox`,
      outbox,
      preferredUsername: "trail_films",
      url: CHANNEL,
      name: "Synthetic Trail Films",
      endpoints: { sharedInbox: `${T}/inbox` },
      publicKey: {
        id: `${CHANNEL}#main-key`,
        owner: CHANNEL,
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nSYNTHETIC-NOT-A-KEY\n-----END PUBLIC KEY-----",
      },
      published: "2026-03-02T10:00:00.000Z",
      icon: [
        { type: "Image", mediaType: "image/png", height: 48, width: 48, url: `${T}/lazy-static/avatars/trail_films-48.png` },
        { type: "Image", mediaType: "image/png", height: 120, width: 120, url: `${T}/lazy-static/avatars/trail_films-120.png` },
      ],
      summary: "Short films from the hill trails. (Synthetic test channel.)",
      support: null,
      postingRestrictedToMods: true,
      attributedTo: [{ type: "Person", id: ACCOUNT }],
    }),
    json(outbox, {
      "@context": AP_CONTEXT,
      id: outbox,
      type: "OrderedCollection",
      totalItems: VIDEOS.length,
      first: `${outbox}?page=1`,
    }),
    json(`${outbox}?page=1`, {
      "@context": AP_CONTEXT,
      id: `${outbox}?page=1`,
      type: "OrderedCollectionPage",
      partOf: outbox,
      totalItems: VIDEOS.length,
      orderedItems: VIDEOS.map((v) => ({
        to: [PUBLIC],
        cc: [`${CHANNEL}/followers`],
        type: "Announce",
        id: `${videoUrl(v)}/announces/7`,
        actor: CHANNEL,
        object: videoUrl(v),
      })),
    }),
    ...VIDEOS.map((v) => json(videoUrl(v), videoObject(v))),
  ];
}

// ---------------------------------------------------------------------------------------------
// Podcast: https://synthetic-podcast.example/feed.xml (and its home page)
// ---------------------------------------------------------------------------------------------

const P = `https://${PODCAST}`;
const PODCAST_FEED = `${P}/feed.xml`;
const PODCAST_ETAG = '"syn-ep3-20261020"';

const PODCAST_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Synthetic Commons Radio</title>
    <link>${P}/</link>
    <atom:link href="${PODCAST_FEED}" rel="self" type="application/rss+xml"/>
    <description>Conversations about the neighborhood commons. A synthetic test podcast.</description>
    <language>en-us</language>
    <copyright>CC BY 4.0</copyright>
    <lastBuildDate>Tue, 20 Oct 2026 09:00:00 GMT</lastBuildDate>
    <itunes:author>Synthetic Commons</itunes:author>
    <itunes:owner>
      <itunes:name>Synthetic Commons</itunes:name>
      <itunes:email>owner@${PODCAST}</itunes:email>
    </itunes:owner>
    <itunes:image href="${P}/art/cover-3000.jpg"/>
    <itunes:category text="Society &amp; Culture"/>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <item>
      <title>Episode 3: Libraries after dark</title>
      <link>${P}/episodes/3</link>
      <guid isPermaLink="false">synthetic-commons-radio-ep3</guid>
      <pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>
      <author>hosts@${PODCAST} (Ana Ruiz and Ben Okafor)</author>
      <description>What happens when the library stays open until midnight.</description>
      <content:encoded><![CDATA[<p>What happens when the library stays open until midnight? <strong>Ana</strong> and <strong>Ben</strong> visit the night shift.</p><p>Show notes: <a href="${P}/episodes/3#notes">links and transcript</a>.</p>]]></content:encoded>
      <enclosure url="${P}/audio/ep3.mp3" length="40560000" type="audio/mpeg"/>
      <itunes:duration>00:42:15</itunes:duration>
      <itunes:image href="${P}/art/ep3.jpg"/>
      <itunes:episode>3</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
    </item>
    <item>
      <title>Episode 2: The bridge vote</title>
      <link>${P}/episodes/2</link>
      <guid isPermaLink="false">synthetic-commons-radio-ep2</guid>
      <pubDate>Thu, 15 Oct 2026 17:30:00 GMT</pubDate>
      <description><![CDATA[<p>The council votes on the footbridge. We ask who will use it.</p>]]></description>
      <enclosure url="${P}/audio/ep2.mp3" length="62880000" type="audio/mpeg"/>
      <itunes:duration>1:05:30</itunes:duration>
      <itunes:episode>2</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
    </item>
    <item>
      <title>Episode 1: Hello, neighbors</title>
      <link>${P}/episodes/1</link>
      <guid isPermaLink="false">synthetic-commons-radio-ep1</guid>
      <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate>
      <description>Why we started a radio show about the commons.</description>
      <enclosure url="${P}/audio/ep1.m4a" length="28800000" type="audio/x-m4a"/>
      <itunes:duration>1800</itunes:duration>
      <itunes:episode>1</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
    </item>
    <item>
      <title>Pilot</title>
      <link>${P}/episodes/pilot</link>
      <guid isPermaLink="false">synthetic-commons-radio-pilot</guid>
      <pubDate>Fri, 16 Jan 2026 12:00:00 GMT</pubDate>
      <description>A test recording, kept for the record.</description>
      <enclosure url="${P}/audio/pilot.mp3" length="9600000" type="audio/mpeg"/>
      <itunes:duration>10:00</itunes:duration>
      <itunes:episodeType>trailer</itunes:episodeType>
    </item>
  </channel>
</rss>
`;

const PODCAST_HOME = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Synthetic Commons Radio</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="alternate" type="application/rss+xml" title="Synthetic Commons Radio (podcast feed)" href="/feed.xml">
</head>
<body>
  <h1>Synthetic Commons Radio</h1>
  <p>A synthetic test podcast. Subscribe with the <a href="/feed.xml">podcast feed</a>.</p>
</body>
</html>
`;

function podcastFixtures(): HttpFixture[] {
  const feedHeaders = { "content-type": "application/rss+xml; charset=utf-8", etag: PODCAST_ETAG };
  return [
    notHub(PODCAST),
    { url: `${P}/`, status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: PODCAST_HOME },
    { url: PODCAST_FEED, status: 200, headers: feedHeaders, body: PODCAST_RSS },
    {
      url: PODCAST_FEED,
      requestHeaders: { "if-none-match": PODCAST_ETAG },
      status: 304,
      headers: { etag: PODCAST_ETAG },
      body: "",
    },
  ];
}

function main(): void {
  for (const host of [TUBE, PODCAST]) fs.rmSync(path.join(OUT_DIR, host), { recursive: true, force: true });
  const written = [...tubeFixtures(), ...podcastFixtures()].map(save);
  console.log(`Wrote ${written.length} synthetic fixture(s):\n${written.join("\n")}`);
}

main();
