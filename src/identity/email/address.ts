// Email addresses: checking, normalizing and masking. Addresses live only in the identity schema
// (spec 3.2); logs only ever see the masked form.

const LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The address lowercased and trimmed, or undefined when it isn't a plausible address. */
export function normalizeEmail(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return undefined;
  const at = email.lastIndexOf("@");
  if (at < 1 || email.indexOf("@") !== at) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return undefined;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return undefined;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return undefined;
  return email;
}

/** `j***@e***.com`: enough to recognize your own address, not enough to learn someone's. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host[0] ?? ""}***${tld}`;
}
