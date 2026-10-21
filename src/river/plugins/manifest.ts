// Checks a plugin manifest (spec 4.7) before the registry accepts it. A manifest that doesn't
// check out is refused at startup, never half-loaded.
import { CAPABILITIES, SURFACES, type Capability, type PluginManifest, type Surface } from "./api.js";

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ManifestError(`${field} must be a list of strings`);
  }
  if (new Set(value).size !== value.length) throw new ManifestError(`${field} lists something twice`);
  return value;
}

/** The manifest, checked and frozen; throws ManifestError naming the first problem. */
export function validateManifest(value: unknown): PluginManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError("A manifest is an object");
  }
  const m = value as Record<string, unknown>;
  const known = new Set(["id", "kind", "version", "surfaces", "title", "capabilities"]);
  const extra = Object.keys(m).filter((k) => !known.has(k));
  if (extra.length > 0) throw new ManifestError(`Unknown manifest field "${extra[0]}"`);

  if (typeof m.id !== "string" || !ID.test(m.id) || m.id.length > 60) {
    throw new ManifestError("id must be lowercase words joined by hyphens");
  }
  if (m.kind !== "view") throw new ManifestError(`${m.id}: kind must be "view" (the only River plugin kind in v1)`);
  if (typeof m.version !== "string" || !VERSION.test(m.version)) {
    throw new ManifestError(`${m.id}: version must look like 1.0.0`);
  }
  if (typeof m.title !== "string" || m.title.trim() === "" || m.title.length > 60) {
    throw new ManifestError(`${m.id}: title must be 1-60 characters`);
  }
  const surfaces = stringList(m.surfaces, `${m.id}: surfaces`);
  if (surfaces.length === 0) throw new ManifestError(`${m.id}: surfaces must name at least one surface`);
  const badSurface = surfaces.find((s) => !(SURFACES as readonly string[]).includes(s));
  if (badSurface) throw new ManifestError(`${m.id}: unknown surface "${badSurface}"`);
  const capabilities = stringList(m.capabilities, `${m.id}: capabilities`);
  const badCapability = capabilities.find((c) => !(CAPABILITIES as readonly string[]).includes(c));
  if (badCapability) throw new ManifestError(`${m.id}: unknown capability "${badCapability}"`);

  return Object.freeze({
    id: m.id,
    kind: "view",
    version: m.version,
    surfaces: Object.freeze(surfaces as Surface[]),
    title: m.title,
    capabilities: Object.freeze(capabilities as Capability[]),
  });
}
