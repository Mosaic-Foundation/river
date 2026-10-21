// Which addresses the River never fetches (spec Appendix B, ADR-001). Ported from the Civic Hub's
// ssrfGuard.ts (docs/reuse/civic-hub/, reuse approved 2026-10-20): the same ranges, checked with
// node:net's BlockList, plus a refusal of localhost names before any DNS lookup.
import net from "node:net";

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible ::a.b.c.d (deprecated, never public)
  // IPv4-mapped (::ffff:a.b.c.d, ::ffff:7f00:1) needs no entry: BlockList checks a mapped
  // address against the IPv4 ranges above. (Adding ::ffff:0:0/96 here would block every IPv4
  // address: BlockList treats an IPv4 address as its mapped form.)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv6");
}

/** Strips URL brackets and an IPv6 zone id: `[fe80::1%en0]` → `fe80::1`. */
export function bareHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
}

/** True if an IP literal (v4 or v6) is in a range the River must never fetch. */
export function isBlockedIp(ip: string): boolean {
  const bare = bareHost(ip);
  if (net.isIPv4(bare)) return BLOCKED.check(bare, "ipv4");
  if (net.isIPv6(bare)) return BLOCKED.check(bare, "ipv6");
  return true; // not an address at all: fail closed
}

/** Names that mean this machine whatever DNS says (RFC 6761), refused before any lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const name = bareHost(hostname).toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}
