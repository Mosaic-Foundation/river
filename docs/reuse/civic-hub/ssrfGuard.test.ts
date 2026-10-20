import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ResponseTooLargeError, guardedFetch, isBlockedIp } from "../../src/utils/ssrfGuard.js";

describe("isBlockedIp", () => {
  it("blocks loopback, private, link-local and metadata ranges", () => {
    const blocked = [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "::1", // IPv6 loopback
      "fe80::1", // IPv6 link-local
      "fd00::1", // IPv6 unique-local
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      // Audit 2: the forms the old string checks missed.
      "::ffff:7f00:1", // IPv4-mapped, hex
      "::ffff:a9fe:a9fe", // mapped metadata (169.254.169.254)
      "::127.0.0.1", // IPv4-compatible
      "::7f00:1", // IPv4-compatible, hex
      "64:ff9b::7f00:1", // NAT64
      "2002:7f00:1::", // 6to4
      "2001:0:1::1", // Teredo
      "fe80::1%en0", // link-local with a zone id
      "febf::1", // the rest of fe80::/10
      "[::1]", // bracketed
      "::", // unspecified
      "198.18.0.1", // benchmarking
      "240.0.0.1", // reserved
    ];
    for (const ip of blocked) {
      expect(isBlockedIp(ip), `${ip} should be blocked`).toBe(true);
    }
  });

  it("allows normal public addresses", () => {
    const allowed = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34", // example.com
      "172.15.0.1", // just outside 172.16/12
      "172.32.0.1", // just outside 172.16/12
      "2606:4700:4700::1111", // public IPv6 (Cloudflare)
      "::ffff:8.8.8.8", // a public IPv4, mapped
    ];
    for (const ip of allowed) {
      expect(isBlockedIp(ip), `${ip} should be allowed`).toBe(false);
    }
  });

  it("fails closed on garbage input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("guardedFetch", () => {
  let server: Server;
  let base = "";
  let hits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits += 1;
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(64 * 1024));
      } else if (req.url === "/to-internal") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.CIVIC_SSRF_ALLOW_PRIVATE;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refuses an internal address by literal or by name, before any request is sent", async () => {
    hits = 0;
    await expect(guardedFetch(`${base}/`)).rejects.toThrow(/internal address/i);
    const port = new URL(base).port;
    await expect(guardedFetch(`http://localhost:${port}/`)).rejects.toThrow(/internal address/i);
    await expect(guardedFetch(`http://[::ffff:7f00:1]:${port}/`)).rejects.toThrow(/internal address/i);
    expect(hits).toBe(0);
  });

  it("refuses other schemes and credentials in the URL", async () => {
    await expect(guardedFetch("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(guardedFetch("http://user:pass@example.com/")).rejects.toThrow(/password/);
  });

  describe("with private addresses allowed (local development only)", () => {
    beforeAll(() => {
      process.env.CIVIC_SSRF_ALLOW_PRIVATE = "true";
    });

    it("fetches, and returns a Response with the final URL", async () => {
      const res = await guardedFetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
      expect(res.url).toBe(`${base}/`);
    });

    it("stops reading past the size cap", async () => {
      await expect(guardedFetch(`${base}/big`, { maxBytes: 1024 })).rejects.toBeInstanceOf(ResponseTooLargeError);
      const whole = await guardedFetch(`${base}/big`, { maxBytes: 128 * 1024 });
      expect((await whole.text()).length).toBe(64 * 1024);
    });

    it("hands back a redirect unfollowed when asked to", async () => {
      const res = await guardedFetch(`${base}/to-internal`, { redirect: "manual" });
      expect(res.status).toBe(302);
    });
  });
});
