// Hub UI URLs to stream keys (spec 4.2 Streams). A hub's activity `context.id` is always
// https://{host}/process/{id}, while the URLs people copy from the hub's pages use other paths
// (/meeting-summary/{id}, /brief/{id}, ...), so the key is rebuilt from the process id.

/** Paths whose next segment is a process id. */
export const STREAM_PATHS = ["process", "meeting-summary", "project", "brief", "announcement"] as const;

// The spec says proc_[0-9a-f]+, but hubs also serve seeded ids such as Floyd's
// proc_beta_vote_energy_001, so lowercase letters, digits and underscores are accepted. The key is
// validated against the hub before anything is followed, so a wider pattern admits nothing new.
const PROCESS_ID = /^proc_[a-z0-9_]{1,64}$/;

/** The stream key for a host and process id. */
export function streamKey(host: string, processId: string): string {
  return `https://${host.toLowerCase()}/process/${processId}`;
}

/** The process id in a hub UI URL's path, or undefined when the URL names no process. */
export function processIdFromPath(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const kind = segments[i] as (typeof STREAM_PATHS)[number];
    if (STREAM_PATHS.includes(kind) && PROCESS_ID.test(segments[i + 1])) return segments[i + 1];
  }
  return undefined;
}

/** The stream key a hub UI URL points at, or undefined. */
export function streamKeyFromUrl(url: URL): string | undefined {
  const id = processIdFromPath(url.pathname);
  return id ? streamKey(url.host, id) : undefined;
}
