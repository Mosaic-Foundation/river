// Which instance a request is for, from its hostname (ADR-004, spec F1, check 26). The lookup runs
// in forHost(), the one helper with no settings, which row-level security limits to reading
// river.instances.
//
//   - An instance's own hostname maps to that instance.
//   - Any host in INSTANCE_HOST_ALIASES (localhost, the River's vercel.app hosts until DNS is set)
//     maps to the seed instance.
//   - On a Vercel preview deployment (VERCEL_ENV=preview) every host maps to the seed instance.
//   - Anything else is unknown: the caller answers 404.
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { forHost, type ClientSource } from "../db/context.js";

/** The seed instance, river.mosaic.social (migration 20261020213536_seed_instance.sql). */
export const SEED_INSTANCE_ID = "00000000-0000-4000-8000-000000000001";

/** instances.seed_follows entries: what a person would type in the follow box. */
export interface SeedFollow {
  url: string;
  stream_key?: string;
  circles: string[];
}

/** instances.default_circles entries; members name spaces as seed_follows does. */
export interface DefaultCircle {
  name: string;
  color?: string;
  role?: "civic";
  members: string[];
}

export interface Instance {
  id: string;
  hostname: string;
  name: string;
  theme: "mosaic" | "civic";
  modesEnabled: string[];
  defaultMode: string;
  seedFollows: SeedFollow[];
  defaultCircles: DefaultCircle[];
  plugins: unknown[];
}

interface InstanceRow {
  id: string;
  hostname: string;
  name: string;
  theme: "mosaic" | "civic";
  modes_enabled: string[];
  default_mode: string;
  seed_follows: unknown;
  default_circles: unknown;
  plugins: unknown;
}

/** Lowercase, without a port or a trailing dot; undefined for anything that isn't a hostname. */
export function normalizeHost(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end === -1 ? "" : host.slice(0, end + 1);
  } else {
    host = host.replace(/:\d+$/, "");
  }
  host = host.replace(/\.$/, "");
  return /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/.test(host) ? host : undefined;
}

/** True when this host gets the seed instance without its own row (aliases, previews). */
export function isSeedAlias(host: string): boolean {
  return env.vercelEnv === "preview" || env.instanceHostAliases.includes(host);
}

function asArray<T>(value: unknown, keep: (v: unknown) => v is T): T[] {
  return Array.isArray(value) ? value.filter(keep) : [];
}

function isSeedFollow(v: unknown): v is SeedFollow {
  const f = v as SeedFollow;
  return Boolean(f) && typeof f.url === "string" && Array.isArray(f.circles);
}

function isDefaultCircle(v: unknown): v is DefaultCircle {
  const c = v as DefaultCircle;
  return Boolean(c) && typeof c.name === "string" && Array.isArray(c.members);
}

function toInstance(row: InstanceRow): Instance {
  return {
    id: row.id,
    hostname: row.hostname,
    name: row.name,
    theme: row.theme,
    modesEnabled: row.modes_enabled,
    defaultMode: row.default_mode,
    seedFollows: asArray(row.seed_follows, isSeedFollow),
    defaultCircles: asArray(row.default_circles, isDefaultCircle),
    plugins: Array.isArray(row.plugins) ? row.plugins : [],
  };
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; instance: Instance | undefined }>();

/** Clears the lookup cache (tests). */
export function clearInstanceCache(): void {
  cache.clear();
}

/** The instance for a hostname, or undefined. Cached per process for a minute. */
export async function instanceForHost(
  rawHost: string | undefined,
  source?: ClientSource,
): Promise<Instance | undefined> {
  const host = normalizeHost(rawHost);
  if (!host) return undefined;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.instance;

  const columns = "id, hostname, name, theme, modes_enabled, default_mode, seed_follows, default_circles, plugins";
  const { rows } = await forHost(
    (db) =>
      isSeedAlias(host)
        ? db.query<InstanceRow>(`SELECT ${columns} FROM river.instances WHERE id = $1`, [SEED_INSTANCE_ID])
        : db.query<InstanceRow>(`SELECT ${columns} FROM river.instances WHERE hostname = $1`, [host]),
    source,
  );
  const instance = rows[0] ? toInstance(rows[0]) : undefined;
  cache.set(host, { at: Date.now(), instance });
  return instance;
}

/**
 * For the keep-alive (GET /health/db): one uncached read of river.instances, so the database sees
 * activity and the free Supabase project isn't paused. Throws when the database doesn't answer.
 */
export async function databaseAnswers(source?: ClientSource): Promise<void> {
  await forHost((db) => db.query("SELECT count(*) FROM river.instances"), source);
}

/** Express middleware: puts the request's instance in res.locals.instance, or answers 404. */
export function requireInstance() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const instance = await instanceForHost(req.hostname);
      if (!instance) {
        res.status(404).json({ error: "unknown_host", message: "There is no River at this address." });
        return;
      }
      res.locals.instance = instance;
      next();
    } catch (err) {
      next(err);
    }
  };
}
