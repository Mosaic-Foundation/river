// Why the fetch guard did not return a response. Callers map a code to what a person sees (spec F6)
// with followMessage(); the codes never carry the response body or request headers.

export type FetchErrorCode =
  /** Not a URL. */
  | "invalid_url"
  /** Not https:, on the first request or a redirect. */
  | "not_https"
  /** A user name or password in the URL. */
  | "credentials"
  /** The host is, or resolves to, a loopback, private, link-local, metadata or reserved address. */
  | "blocked_address"
  /** DNS has no answer for the host. */
  | "unresolvable_host"
  /** More than three redirects. */
  | "too_many_redirects"
  /** The body is larger than 2 MB. */
  | "too_large"
  /** The 6 s budget ran out. */
  | "timeout"
  /** The host asked us to wait (Retry-After) and the time hasn't come. */
  | "retry_later"
  /** Replay mode (FETCH_FIXTURES_DIR) has no recorded response for this request. */
  | "no_fixture"
  /** Anything else on the way: refused connection, TLS failure, reset. */
  | "network";

export class FetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
    /** For retry_later: when the host accepts requests again (ms since the epoch). */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/** Codes that mean the address itself is off limits, not that it was down. */
const REFUSED: ReadonlySet<FetchErrorCode> = new Set(["invalid_url", "not_https", "credentials", "blocked_address"]);

/** The follow box's wording (spec F6) for a failed fetch. */
export function followMessage(err: unknown): string {
  if (err instanceof FetchError && REFUSED.has(err.code)) return "This address can't be followed";
  return "We couldn't reach that address";
}
