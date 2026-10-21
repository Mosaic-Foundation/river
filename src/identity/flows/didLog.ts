// GET /u/{code}/did.jsonl (spec 4.6, check 9): the person's did:webvh log, one JSON line per
// version, Content-Type text/jsonl. Public: anyone may resolve a DID.
import { forIdentity } from "../../db/context.js";
import { readDidLog, lookups } from "../store.js";
import type { Routes } from "./common.js";

export function didLogRoutes(router: Routes): void {
  router.get("/u/:code/did.jsonl", async (req, res) => {
    const code = req.params.code;
    const personId = /^[a-z2-7]{8}$/.test(code) ? await forIdentity({}, (db) => lookups.personByCode(db, code)) : undefined;
    const lines = personId ? await forIdentity({ personId }, (db) => readDidLog(db, personId)) : [];
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (lines.length === 0) {
      res.status(404).type("text/plain").send("No DID here.");
      return;
    }
    const body = Buffer.from(lines.map((line) => `${line}\n`).join(""), "utf8");
    // Set the type exactly (res.send would append a charset).
    res.status(200);
    res.setHeader("Content-Type", "text/jsonl");
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Cache-Control", "no-cache");
    res.end(body);
  });
}
