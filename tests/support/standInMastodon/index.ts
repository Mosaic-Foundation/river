// The stand-in fediverse server (fediverse-posting-1.md item 9; ADR-011): a Mastodon-shaped server
// built from the documented requests and answers (the `mastodon/documentation` repo, read
// 2026-10-26), with a GoToSocial mode, for tests only. Nothing here is a recording: every shape is
// SYNTHETIC, written from the docs, until A5 records real answers.
//
// Hosts (all reserved `.example` names):
//   mastodon.stand-in.example      Mastodon 4.3.2: NodeInfo, the discovery document (S256), 500 characters
//   gts.stand-in.example           GoToSocial 0.19.1: no discovery document, 5,000 characters,
//                                  `read:accounts` instead of `profile`, no `uri` on accounts
//   mastodon42.stand-in.example    Mastodon 4.2.10 (too old: no PKCE, no `profile`)
//   nodiscovery.stand-in.example   Mastodon 4.4.0 that serves no discovery document
//   akkoma.stand-in.example        NodeInfo says `akkoma`
//   elsewhere.stand-in.example     the target of the redirect switch; it answers 200 to anything
//                                  and counts what reaches it
// Each server has the accounts `ana` and `bob`.
//
// It serves what linking needs (item 1): WebFinger, NodeInfo, the discovery document,
// `/api/v2/instance`, `POST /api/v1/apps`, `POST /oauth/token`, `POST /oauth/revoke` and
// `GET /api/v1/accounts/verify_credentials`. The authorize page is a browser navigation, not a
// River request, so it is a method here (`authorize()`), as if the member approved (or denied).
// For posts and replies (A3, item 3): `GET /api/v2/search` (resolving any https URI to a local
// status, except one whose path contains `/missing`) and `POST /api/v1/statuses`, which keeps
// each `Idempotency-Key` for an hour per account on Mastodon (and ignores it on GoToSocial, whose
// support isn't checked), counts characters as the server's limit does, and records each post;
// and `DELETE /api/v1/statuses/:id` for the member's own posts.
// A4 adds the toggles.
//
// It records every request it receives (headers and bodies included: tests look for tokens in
// them), checks client credentials, PKCE, tokens and scopes as Mastodon does, and has rules that
// override any answer: 401, 403, 422, 429 with Retry-After, 5xx, a redirect to
// elsewhere.stand-in.example, or a dropped connection.
//
// `handle()` is synchronous and HTTP-free, so unit tests call it directly. `guardOptions()` puts
// it behind the River's fetch guard through an injected undici dispatcher; the River's dev server
// does that when TEST_STAND_IN_FEDIVERSE=1 (refused on Vercel).
import { createHash, randomBytes } from "node:crypto";
import { Dispatcher, MockAgent } from "undici";

export const MASTODON_HOST = "mastodon.stand-in.example";
export const GTS_HOST = "gts.stand-in.example";
export const OLD_MASTODON_HOST = "mastodon42.stand-in.example";
export const NO_DISCOVERY_HOST = "nodiscovery.stand-in.example";
export const AKKOMA_HOST = "akkoma.stand-in.example";
export const ELSEWHERE_HOST = "elsewhere.stand-in.example";

/** The address every stand-in host resolves to. Nothing connects to it; it must only be public. */
export const STAND_IN_ADDRESS = { address: "93.184.215.14", family: 4 };

export interface StandInServerConfig {
  software: "mastodon" | "gotosocial" | "akkoma";
  version: string;
  /** Serves `/.well-known/oauth-authorization-server`. */
  discovery: boolean;
  maxCharacters: number;
  charactersReservedPerUrl: number;
  /** Scopes the server knows; an app or authorization asking for another is refused. */
  scopes: readonly string[];
}

const MASTODON_SCOPES = [
  "read", "write", "follow", "push", "profile",
  "read:accounts", "read:blocks", "read:bookmarks", "read:favourites", "read:filters", "read:follows",
  "read:lists", "read:mutes", "read:notifications", "read:search", "read:statuses",
  "write:accounts", "write:blocks", "write:bookmarks", "write:conversations", "write:favourites",
  "write:filters", "write:follows", "write:lists", "write:media", "write:mutes", "write:notifications",
  "write:reports", "write:statuses",
];

const GTS_SCOPES = MASTODON_SCOPES.filter((s) => s !== "profile" && s !== "follow" && s !== "push");

export const STAND_IN_SERVERS: Readonly<Record<string, StandInServerConfig>> = Object.freeze({
  [MASTODON_HOST]: { software: "mastodon", version: "4.3.2", discovery: true, maxCharacters: 500, charactersReservedPerUrl: 23, scopes: MASTODON_SCOPES },
  [GTS_HOST]: { software: "gotosocial", version: "0.19.1 git-2b3c4d5", discovery: false, maxCharacters: 5000, charactersReservedPerUrl: 25, scopes: GTS_SCOPES },
  [OLD_MASTODON_HOST]: { software: "mastodon", version: "4.2.10", discovery: false, maxCharacters: 500, charactersReservedPerUrl: 23, scopes: MASTODON_SCOPES.filter((s) => s !== "profile") },
  [NO_DISCOVERY_HOST]: { software: "mastodon", version: "4.4.0", discovery: false, maxCharacters: 500, charactersReservedPerUrl: 23, scopes: MASTODON_SCOPES },
  [AKKOMA_HOST]: { software: "akkoma", version: "3.15.2", discovery: false, maxCharacters: 5000, charactersReservedPerUrl: 23, scopes: MASTODON_SCOPES },
});

export const STAND_IN_HOSTS: readonly string[] = [...Object.keys(STAND_IN_SERVERS), ELSEWHERE_HOST];

export interface StandInAccount {
  id: string;
  username: string;
  displayName: string;
  locked: boolean;
  /** `source.privacy` and `source.language`. */
  privacy: "public" | "unlisted" | "private";
  language: string | null;
}

export const STAND_IN_ACCOUNTS: readonly StandInAccount[] = Object.freeze([
  { id: "109000000000000001", username: "ana", displayName: "Ana (stand-in)", locked: false, privacy: "unlisted", language: "en" },
  { id: "109000000000000002", username: "bob", displayName: "Bob <b>stand-in</b>", locked: true, privacy: "public", language: null },
]);

/** One request as the stand-in received it. Header names are lowercase. */
export interface StandInRequest {
  host: string;
  method: string;
  /** Path and query. */
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface StandInAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * A rule overrides the answer to matching requests. `path` matches the start of the pathname;
 * `host` and `method` match exactly when given.
 */
export interface StandInRule {
  host?: string;
  method?: string;
  path: string;
  /** A status (with Mastodon's error body), a 307 to elsewhere.stand-in.example, or a dropped connection. */
  /**
   * A status, a 307 to elsewhere.stand-in.example, a dropped connection, or "slow": the request
   * arrives and is handled as usual, but the answer comes after SLOW_MS (longer than the guard's
   * 6 s), so the River times out not knowing whether it worked.
   */
  answer: 401 | 403 | 404 | 422 | 429 | 500 | 502 | 503 | 504 | "redirect" | "down" | "slow";
  /** The error text for 422 (and any status). */
  message?: string;
  /** Seconds, for 429 and 503. */
  retryAfter?: number;
}

/** How late a "slow" answer comes. */
export const SLOW_MS = 8_000;

/** A status the stand-in holds: posted through it, or a remote post it resolved. */
export interface StandInStatus {
  id: string;
  host: string;
  uri: string;
  url: string;
  /** The poster's username; undefined for a resolved remote post. */
  account?: string;
  content: string;
  spoilerText: string;
  visibility: string;
  inReplyToId: string | null;
  language: string | null;
  idempotencyKey?: string;
  createdAt: number;
}

export interface StandInApp {
  host: string;
  clientId: string;
  clientSecret: string;
  name: string;
  website: string | undefined;
  redirectUris: string[];
  scopes: string[];
}

interface Code {
  host: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  account: StandInAccount;
  challenge: string;
  used: boolean;
}

export interface StandInToken {
  host: string;
  clientId: string;
  scopes: string[];
  account: StandInAccount;
  revoked: boolean;
}

const ERRORS: Record<number, string> = {
  401: "The access token is invalid",
  403: "This action is outside the authorized scopes",
  404: "Record not found",
  422: "Validation failed: Text can't be blank",
  429: "Too many requests",
  500: "We're sorry, but something went wrong on our end.",
  502: "Bad gateway",
  503: "Service unavailable",
  504: "Gateway timeout",
};

export class StandInFediverse {
  readonly requests: StandInRequest[] = [];
  readonly rules: StandInRule[] = [];
  /** Registered apps by client_id. */
  readonly apps = new Map<string, StandInApp>();
  /** Issued tokens by value. */
  readonly tokens = new Map<string, StandInToken>();
  /** Statuses by id: posted here or resolved by search. */
  readonly statuses = new Map<string, StandInStatus>();
  /** Statuses deleted through `DELETE /api/v1/statuses/:id`, in order. */
  readonly deleted: StandInStatus[] = [];
  /** The clock for idempotency keys, in ms (tests may move it). */
  now: () => number = Date.now;
  private nextStatusId = 110_000_000_000_000_000n;
  private readonly codes = new Map<string, Code>();

  /** Forgets everything: requests, rules, apps, codes and tokens. */
  reset(): void {
    this.requests.length = 0;
    this.rules.length = 0;
    this.apps.clear();
    this.tokens.clear();
    this.codes.clear();
    this.statuses.clear();
    this.deleted.length = 0;
    this.now = Date.now;
  }

  /** Statuses posted through the stand-in (not resolved remote ones), oldest first. */
  posted(): StandInStatus[] {
    return [...this.statuses.values()].filter((s) => s.account !== undefined);
  }

  /** Requests to one host (and, optionally, one path prefix). */
  requestsTo(host: string, path?: string): StandInRequest[] {
    return this.requests.filter((r) => r.host === host && (path === undefined || r.path.startsWith(path)));
  }

  /** Marks every token revoked, as if the member removed the app on their server. */
  revokeAll(): void {
    for (const token of this.tokens.values()) token.revoked = true;
  }

  /** The rule a request falls under, if any. */
  ruleFor(host: string, method: string, path: string): StandInRule | undefined {
    const pathname = path.split("?")[0] ?? path;
    return this.rules.find(
      (r) => (r.host === undefined || r.host === host) && (r.method === undefined || r.method === method) && pathname.startsWith(r.path),
    );
  }

  /**
   * The authorize page (`GET /oauth/authorize`), as if `username` signed in there and approved
   * (or, with `deny`, refused). Returns where the server sends the browser, or a refusal for a
   * request it would show an error page for.
   */
  authorize(authorizeUrl: string, username: string, options: { deny?: boolean } = {}): { location: string } | { error: string } {
    let url: URL;
    try {
      url = new URL(authorizeUrl);
    } catch {
      return { error: "malformed URL" };
    }
    const server = STAND_IN_SERVERS[url.host];
    if (!server || url.protocol !== "https:" || url.pathname !== "/oauth/authorize") return { error: "not an authorize URL" };
    const q = url.searchParams;
    const app = this.apps.get(q.get("client_id") ?? "");
    if (!app || app.host !== url.host) return { error: "unknown client_id" };
    const redirectUri = q.get("redirect_uri") ?? "";
    if (!app.redirectUris.includes(redirectUri)) return { error: "redirect_uri not registered" };
    if (q.get("response_type") !== "code") return { error: "response_type must be code" };
    const scopes = (q.get("scope") ?? "").split(/\s+/).filter(Boolean);
    if (scopes.length === 0 || !scopes.every((s) => app.scopes.includes(s))) return { error: "scope outside the app's scopes" };
    const challenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return { error: "PKCE S256 required" };
    const account = STAND_IN_ACCOUNTS.find((a) => a.username === username);
    if (!account) return { error: "no such account" };

    const back = new URL(redirectUri);
    const state = q.get("state");
    if (options.deny) {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "The resource owner or authorization server denied the request.");
    } else {
      const code = opaque();
      this.codes.set(code, { host: url.host, clientId: app.clientId, redirectUri, scopes, account, challenge, used: false });
      back.searchParams.set("code", code);
    }
    if (state !== null) back.searchParams.set("state", state);
    return { location: back.toString() };
  }

  /** Answers one request. Records it first, whatever the answer. */
  handle(request: StandInRequest): StandInAnswer {
    this.requests.push({ ...request, headers: lower(request.headers) });
    const { host, method } = request;
    const url = new URL(request.path, `https://${host}`);

    if (host === ELSEWHERE_HOST) return json(200, { caught: true });
    const server = STAND_IN_SERVERS[host];
    if (!server) return json(404, { error: "Record not found" });

    const rule = this.ruleFor(host, method, request.path);
    // Through the dispatcher a "down" rule drops the connection before this; called directly, it
    // is a 503. A "slow" rule changes only when the answer comes.
    if (rule && rule.answer !== "slow") return ruleAnswer(rule);

    const route = `${method} ${url.pathname}`;
    switch (route) {
      case "GET /.well-known/webfinger":
        return this.webfinger(host, url);
      case "GET /.well-known/nodeinfo":
        return json(200, { links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.0", href: `https://${host}/nodeinfo/2.0` }] });
      case "GET /nodeinfo/2.0":
        return json(200, {
          version: "2.0",
          software: { name: server.software, version: server.version },
          protocols: ["activitypub"],
          services: { outbound: [], inbound: [] },
          usage: { users: { total: STAND_IN_ACCOUNTS.length }, localPosts: 0 },
          openRegistrations: false,
          metadata: {},
        });
      case "GET /.well-known/oauth-authorization-server":
        return server.discovery ? json(200, discovery(host, server)) : json(404, { error: "Record not found" });
      case "GET /api/v2/instance":
        return json(200, instance(host, server));
      case "POST /api/v1/apps":
        return this.registerApp(host, server, request);
      case "POST /oauth/token":
        return this.token(host, request);
      case "POST /oauth/revoke":
        return this.revoke(host, request);
      case "GET /api/v1/accounts/verify_credentials":
        return this.verifyCredentials(host, server, request);
      case "GET /api/v2/search":
        return this.search(host, url, request);
      case "POST /api/v1/statuses":
        return this.postStatus(host, server, request);
      default:
        if (method === "DELETE" && /^\/api\/v1\/statuses\/[^/]+$/.test(url.pathname)) {
          return this.deleteStatus(host, url.pathname.split("/").pop() ?? "", request);
        }
        return json(404, { error: "Record not found" });
    }
  }

  private webfinger(host: string, url: URL): StandInAnswer {
    const match = /^acct:([^@]+)@(.+)$/.exec(url.searchParams.get("resource") ?? "");
    const account = STAND_IN_ACCOUNTS.find((a) => a.username === match?.[1]);
    if (!match || match[2] !== host || !account) return json(404, { error: "Record not found" });
    return {
      status: 200,
      headers: { "content-type": "application/jrd+json; charset=utf-8" },
      body: JSON.stringify({
        subject: `acct:${account.username}@${host}`,
        aliases: [actorUri(host, account), profileUrl(host, account)],
        links: [
          { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: profileUrl(host, account) },
          { rel: "self", type: "application/activity+json", href: actorUri(host, account) },
        ],
      }),
    };
  }

  private registerApp(host: string, server: StandInServerConfig, request: StandInRequest): StandInAnswer {
    const params = readParams(request);
    const name = params.get("client_name") ?? "";
    const redirectUris = [...params.getAll("redirect_uris[]"), ...params.getAll("redirect_uris")]
      .flatMap((v) => v.split(/\s+/))
      .filter(Boolean);
    const scopes = (params.get("scopes") ?? "read").split(/\s+/).filter(Boolean);
    if (name === "") return json(422, { error: "Validation failed: Application name can't be blank" });
    if (redirectUris.length === 0) return json(422, { error: "Validation failed: Redirect URI can't be blank" });
    if (!scopes.every((s) => server.scopes.includes(s))) return json(422, { error: "Validation failed: Scopes must only contain allowed scopes" });
    const app: StandInApp = {
      host,
      clientId: opaque(),
      clientSecret: opaque(),
      name,
      website: params.get("website") ?? undefined,
      redirectUris,
      scopes,
    };
    this.apps.set(app.clientId, app);
    const body: Record<string, unknown> = {
      id: String(this.apps.size),
      name: app.name,
      website: app.website ?? null,
      redirect_uri: redirectUris.join("\n"),
      client_id: app.clientId,
      client_secret: app.clientSecret,
      vapid_key: "BCk-QqERU0q-CfYZjcuB6lnyyOYfJ2AifKqfeGIm7Z-HiTU5T9eTG5GxVA0_OH5mMlI4UkkDTpaZwozy0TzdZ2M=",
    };
    if (server.software === "mastodon") {
      Object.assign(body, { scopes, redirect_uris: redirectUris, client_secret_expires_at: 0 });
    }
    return json(200, body);
  }

  /** The app a form names, if its client_id and client_secret both match on this host. */
  private client(host: string, params: URLSearchParams): StandInApp | undefined {
    const app = this.apps.get(params.get("client_id") ?? "");
    return app && app.host === host && app.clientSecret === params.get("client_secret") ? app : undefined;
  }

  private token(host: string, request: StandInRequest): StandInAnswer {
    const params = readParams(request);
    const app = this.client(host, params);
    if (!app) {
      return json(401, { error: "invalid_client", error_description: "Client authentication failed due to unknown client, no client authentication included, or unsupported authentication method." });
    }
    if (params.get("grant_type") !== "authorization_code") return json(400, { error: "unsupported_grant_type" });
    const invalidGrant = json(400, {
      error: "invalid_grant",
      error_description: "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.",
    });
    const code = this.codes.get(params.get("code") ?? "");
    if (!code || code.used || code.host !== host || code.clientId !== app.clientId || code.redirectUri !== params.get("redirect_uri")) {
      return invalidGrant;
    }
    const verifier = params.get("code_verifier") ?? "";
    if (createHash("sha256").update(verifier).digest("base64url") !== code.challenge) return invalidGrant;
    code.used = true;
    const value = opaque();
    this.tokens.set(value, { host, clientId: app.clientId, scopes: code.scopes, account: code.account, revoked: false });
    return json(200, { access_token: value, token_type: "Bearer", scope: code.scopes.join(" "), created_at: 1_761_500_000 });
  }

  private revoke(host: string, request: StandInRequest): StandInAnswer {
    const params = readParams(request);
    const app = this.client(host, params);
    if (!app) return json(403, { error: "unauthorized_client", error_description: "You are not authorized to revoke this token" });
    const token = this.tokens.get(params.get("token") ?? "");
    // RFC 7009: an unknown token is answered 200 too.
    if (token && token.host === host && token.clientId === app.clientId) token.revoked = true;
    return json(200, {});
  }

  /** The token a request's Authorization header carries, or the 401 or 403 to answer. */
  private bearer(host: string, request: StandInRequest, anyOf: readonly string[]): StandInToken | StandInAnswer {
    const header = lower(request.headers).authorization ?? "";
    const token = /^Bearer (.+)$/.exec(header) ? this.tokens.get(header.slice("Bearer ".length)) : undefined;
    if (!token || token.revoked || token.host !== host) return json(401, { error: ERRORS[401] });
    if (!token.scopes.some((s) => anyOf.includes(s))) return json(403, { error: ERRORS[403] });
    return token;
  }

  private verifyCredentials(host: string, server: StandInServerConfig, request: StandInRequest): StandInAnswer {
    const identity = server.software === "mastodon" ? ["profile", "read", "read:accounts"] : ["read", "read:accounts"];
    const token = this.bearer(host, request, identity);
    if ("status" in token) return token;
    const a = token.account;
    const account: Record<string, unknown> = {
      id: a.id,
      username: a.username,
      acct: a.username,
      display_name: a.displayName,
      locked: a.locked,
      bot: false,
      discoverable: true,
      group: false,
      created_at: "2026-01-01T00:00:00.000Z",
      note: "<p>A stand-in account for tests.</p>",
      url: profileUrl(host, a),
      avatar: `https://${host}/avatars/${a.username}.png`,
      avatar_static: `https://${host}/avatars/${a.username}.png`,
      header: `https://${host}/headers/original/missing.png`,
      header_static: `https://${host}/headers/original/missing.png`,
      followers_count: 3,
      following_count: 1,
      statuses_count: 1,
      last_status_at: "2026-10-20",
      emojis: [],
      fields: [],
      source: { privacy: a.privacy, sensitive: false, language: a.language, note: "A stand-in account for tests.", fields: [], follow_requests_count: 0 },
    };
    // Mastodon has served the actor's id as `uri` since 4.2; the GoToSocial stand-in leaves it out.
    if (server.software === "mastodon") account.uri = actorUri(host, a);
    return json(200, account);
  }

  private nextId(): string {
    this.nextStatusId += 1n;
    return String(this.nextStatusId);
  }

  /** `GET /api/v2/search?q=&resolve=true&type=statuses&limit=1`: resolves a post's URI to a local id. */
  private search(host: string, url: URL, request: StandInRequest): StandInAnswer {
    const token = this.bearer(host, request, ["read:search", "read"]);
    if ("status" in token) return token;
    const q = url.searchParams.get("q") ?? "";
    const empty = json(200, { accounts: [], statuses: [], hashtags: [] });
    if (url.searchParams.get("type") !== "statuses" || url.searchParams.get("resolve") !== "true") return empty;
    let target: URL;
    try {
      target = new URL(q);
    } catch {
      return empty;
    }
    if (target.protocol !== "https:" || target.pathname.includes("/missing")) return empty;
    let status = [...this.statuses.values()].find((s) => s.host === host && (s.uri === q || s.url === q));
    if (!status) {
      status = {
        id: this.nextId(),
        host,
        uri: q,
        url: q,
        content: "<p>A remote post.</p>",
        spoilerText: "",
        visibility: "public",
        inReplyToId: null,
        language: null,
        createdAt: this.now(),
      };
      this.statuses.set(status.id, status);
    }
    return json(200, { accounts: [], statuses: [statusJson(status, host)], hashtags: [] });
  }

  /** `POST /api/v1/statuses`, with Mastodon's one-hour Idempotency-Key per account. */
  private postStatus(host: string, server: StandInServerConfig, request: StandInRequest): StandInAnswer {
    const token = this.bearer(host, request, ["write:statuses", "write"]);
    if ("status" in token) return token;
    const params = readParams(request);
    const key = lower(request.headers)["idempotency-key"];
    if (server.software === "mastodon" && key) {
      const earlier = [...this.statuses.values()].find(
        (s) => s.host === host && s.account === token.account.username && s.idempotencyKey === key && this.now() - s.createdAt < 3_600_000,
      );
      if (earlier) return json(200, statusJson(earlier, host));
    }
    const text = params.get("status") ?? "";
    const spoiler = params.get("spoiler_text") ?? "";
    const visibility = params.get("visibility") ?? "public";
    if (text.trim() === "") return json(422, { error: "Validation failed: Text can't be blank" });
    if (!["public", "unlisted", "private", "direct"].includes(visibility)) {
      return json(422, { error: "Validation failed: Visibility is not included in the list" });
    }
    if (characterCount(text, server) + Array.from(spoiler).length > server.maxCharacters) {
      return json(422, { error: `Validation failed: Text character limit of ${server.maxCharacters} exceeded` });
    }
    const inReplyTo = params.get("in_reply_to_id");
    if (inReplyTo && !this.statuses.has(inReplyTo)) return json(404, { error: "Record not found" });
    const id = this.nextId();
    const status: StandInStatus = {
      id,
      host,
      uri: `https://${host}/users/${token.account.username}/statuses/${id}`,
      url: `https://${host}/@${token.account.username}/${id}`,
      account: token.account.username,
      content: `<p>${escapeHtml(text)}</p>`,
      spoilerText: spoiler,
      visibility,
      inReplyToId: inReplyTo || null,
      language: params.get("language") || null,
      ...(key ? { idempotencyKey: key } : {}),
      createdAt: this.now(),
    };
    this.statuses.set(id, status);
    return json(200, statusJson(status, host));
  }

  /** `DELETE /api/v1/statuses/:id`: the member's own status; Mastodon answers with its text. */
  private deleteStatus(host: string, id: string, request: StandInRequest): StandInAnswer {
    const token = this.bearer(host, request, ["write:statuses", "write"]);
    if ("status" in token) return token;
    const status = this.statuses.get(id);
    if (!status || status.host !== host || status.account !== token.account.username) return json(404, { error: "Record not found" });
    this.statuses.delete(id);
    this.deleted.push(status);
    return json(200, { ...statusJson(status, host), text: status.content.replace(/<[^>]+>/g, "") });
  }

  /**
   * Fetch guard options that send the stand-in hosts here and every other host to `fallback`
   * (the replayed fixtures, say). Without a fallback, other hosts don't resolve.
   */
  guardOptions(fallback?: { dispatcher: Dispatcher; resolver: (hostname: string) => Promise<Array<{ address: string; family: number }>> }) {
    const standIn = this.dispatcher();
    const hosts = new Set(STAND_IN_HOSTS);
    const dispatcher = new RoutingDispatcher((origin) => (hosts.has(new URL(origin).host) ? standIn : fallback?.dispatcher));
    const resolver = async (hostname: string) => {
      if (hosts.has(hostname.toLowerCase())) return [STAND_IN_ADDRESS];
      if (fallback) return fallback.resolver(hostname);
      throw Object.assign(new Error(`${hostname} is not a stand-in host`), { code: "ENOTFOUND" });
    };
    return { dispatcher, resolver };
  }

  /** A MockAgent that answers every stand-in host through handle(). */
  dispatcher(): MockAgent {
    const agent = new MockAgent();
    agent.disableNetConnect();
    for (const host of STAND_IN_HOSTS) {
      const pool = agent.get(`https://${host}`);
      // A "down" rule (which matches any method) drops the connection: this interceptor matches
      // only while one applies. Nothing is recorded, since nothing arrived.
      pool
        .intercept({ path: (path: string) => this.downAt(host, path), method: () => true })
        .replyWithError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
        .persist();
      // A "slow" rule: handled now, answered after SLOW_MS (the guard has given up by then).
      pool
        .intercept({ path: (path: string) => this.slowAt(host, path), method: () => true })
        .reply((opts) => this.mockAnswer(host, opts))
        .delay(SLOW_MS)
        .persist();
      pool
        .intercept({ path: () => true, method: () => true })
        .reply((opts) => {
          const answer = this.handle({
            host,
            method: opts.method.toUpperCase(),
            path: opts.path,
            headers: headerRecord(opts.headers),
            body: typeof opts.body === "string" ? opts.body : opts.body === undefined || opts.body === null ? "" : String(opts.body),
          });
          return { statusCode: answer.status, data: answer.body, responseOptions: { headers: answer.headers } };
        })
        .persist();
    }
    return agent;
  }

  private mockAnswer(host: string, opts: { method: string; path: string; headers?: unknown; body?: unknown }) {
    const answer = this.handle({
      host,
      method: opts.method.toUpperCase(),
      path: opts.path,
      headers: headerRecord(opts.headers),
      body: typeof opts.body === "string" ? opts.body : opts.body === undefined || opts.body === null ? "" : String(opts.body),
    });
    return { statusCode: answer.status, data: answer.body, responseOptions: { headers: answer.headers } };
  }

  private slowAt(host: string, path: string): boolean {
    const pathname = path.split("?")[0] ?? path;
    return this.rules.some((r) => r.answer === "slow" && (r.host === undefined || r.host === host) && pathname.startsWith(r.path));
  }

  private downAt(host: string, path: string): boolean {
    const pathname = path.split("?")[0] ?? path;
    return this.rules.some((r) => r.answer === "down" && (r.host === undefined || r.host === host) && pathname.startsWith(r.path));
  }
}

/** Sends each request to the dispatcher `pick` names for its origin; refuses when it names none. */
class RoutingDispatcher extends Dispatcher {
  constructor(private readonly pick: (origin: string) => Dispatcher | undefined) {
    super();
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const target = this.pick(String(options.origin));
    if (!target) throw Object.assign(new Error(`No dispatcher for ${String(options.origin)}`), { code: "ENOTFOUND" });
    return target.dispatch(options, handler);
  }
}

/**
 * Characters as the server counts them: on Mastodon a URL counts as `characters_reserved_per_url`
 * and a mention `@user@domain` as `@user`; elsewhere plain characters (item 3.1).
 */
export function characterCount(text: string, server: Pick<StandInServerConfig, "software" | "charactersReservedPerUrl">): number {
  if (server.software !== "mastodon") return Array.from(text).length;
  const urls = text.replace(/https?:\/\/\S+/g, "x".repeat(server.charactersReservedPerUrl));
  const mentions = urls.replace(/(@[a-z0-9_]+)@[a-z0-9.-]+\.[a-z]+/gi, "$1");
  return Array.from(mentions).length;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function statusJson(status: StandInStatus, host: string): Record<string, unknown> {
  return {
    id: status.id,
    uri: status.uri,
    url: status.url,
    created_at: new Date(status.createdAt).toISOString(),
    content: status.content,
    spoiler_text: status.spoilerText,
    visibility: status.visibility,
    in_reply_to_id: status.inReplyToId,
    language: status.language,
    reblogged: false,
    favourited: false,
    account: status.account
      ? { id: STAND_IN_ACCOUNTS.find((a) => a.username === status.account)?.id, acct: status.account, url: `https://${host}/@${status.account}` }
      : { id: "1", acct: `someone@${new URL(status.uri).host}`, url: status.uri },
  };
}

function opaque(): string {
  return randomBytes(32).toString("base64url");
}

function actorUri(host: string, account: StandInAccount): string {
  return `https://${host}/users/${account.username}`;
}

function profileUrl(host: string, account: StandInAccount): string {
  return `https://${host}/@${account.username}`;
}

function json(status: number, body: unknown): StandInAnswer {
  return { status, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function ruleAnswer(rule: StandInRule): StandInAnswer {
  if (rule.answer === "redirect") {
    return { status: 307, headers: { location: `https://${ELSEWHERE_HOST}/caught`, "content-type": "text/html" }, body: "" };
  }
  const status = rule.answer === "down" || rule.answer === "slow" ? 503 : rule.answer;
  const answer = json(status, { error: rule.message ?? ERRORS[status] ?? "Error" });
  if (rule.retryAfter !== undefined) answer.headers["retry-after"] = String(rule.retryAfter);
  return answer;
}

function discovery(host: string, server: StandInServerConfig): Record<string, unknown> {
  const origin = `https://${host}`;
  return {
    issuer: `${origin}/`,
    service_documentation: "https://docs.joinmastodon.org/",
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    app_registration_endpoint: `${origin}/api/v1/apps`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    userinfo_endpoint: `${origin}/oauth/userinfo`,
    scopes_supported: server.scopes,
    response_types_supported: ["code"],
    response_modes_supported: ["query", "fragment", "form_post"],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  };
}

function instance(host: string, server: StandInServerConfig): Record<string, unknown> {
  return {
    domain: host,
    title: `Stand-in ${server.software}`,
    version: server.version,
    source_url: server.software === "mastodon" ? "https://github.com/mastodon/mastodon" : "https://codeberg.org/superseriousbusiness/gotosocial",
    description: "A stand-in server for the River's tests.",
    registrations: { enabled: false, approval_required: false, message: null },
    contact: { email: "", account: null },
    rules: [],
    configuration: {
      urls: { streaming: `wss://${host}` },
      accounts: { max_featured_tags: 10 },
      statuses: {
        max_characters: server.maxCharacters,
        max_media_attachments: 4,
        characters_reserved_per_url: server.charactersReservedPerUrl,
      },
      polls: { max_options: 4, max_characters_per_option: 50, min_expiration: 300, max_expiration: 2_629_746 },
    },
  };
}

/** Header names in lowercase; repeated headers joined. */
function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}

function headerRecord(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined || headers === null) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, name) => (out[name.toLowerCase()] = value));
    return out;
  }
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) out[String(headers[i]).toLowerCase()] = String(headers[i + 1]);
    return out;
  }
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value !== undefined) out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

/** A form or JSON body as parameters (Mastodon takes both). */
function readParams(request: StandInRequest): URLSearchParams {
  const type = lower(request.headers)["content-type"] ?? "";
  if (type.startsWith("application/json")) {
    const params = new URLSearchParams();
    try {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      for (const [name, value] of Object.entries(body)) {
        if (Array.isArray(value)) for (const v of value) params.append(name, String(v));
        else if (value !== undefined && value !== null) params.append(name, String(value));
      }
    } catch {
      // An unreadable body has no parameters.
    }
    return params;
  }
  return new URLSearchParams(request.body);
}
