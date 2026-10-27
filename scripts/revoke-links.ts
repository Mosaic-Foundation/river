// `npm run revoke-links`: revokes every credential the River holds for members and deletes it
// (ADR-010 §5; runbook in docs/deploy.md, "If RIVER_TOKEN_KEY leaks"). Adam runs it on his own
// machine, never on a server.
//
//   npm run revoke-links                 dry run: opens each credential, changes nothing
//   npm run revoke-links -- --apply      revokes at each server, deletes every credential
//   npm run revoke-links -- --apply --instance <uuid>
//
// DATABASE_URL (as river_app, the production pooler URL), DATABASE_CA_CERT and RIVER_TOKEN_KEY (the
// key the credentials were sealed with) are read through src/config/env.ts; put them in
// .env.revoke (gitignored) or the shell, and delete the file afterwards. The report names servers
// and counts only.
import { parseArgs } from "node:util";
import { env } from "../src/config/env.js";
import { closePool } from "../src/db/pool.js";
import { formatReport, revokeLinks } from "../src/river/acting/revoke.js";

const USAGE = "Usage: npm run revoke-links -- [--apply] [--instance <uuid>]";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      instance: { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.instance !== undefined && !UUID.test(values.instance)) {
    console.error(USAGE);
    return 2;
  }
  if (env.onVercel) {
    console.error("revoke-links runs on Adam's machine, not on Vercel.");
    return 2;
  }
  const report = await revokeLinks({ apply: values.apply, instanceId: values.instance });
  for (const line of formatReport(report)) console.log(line);
  return 0;
}

main()
  .then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      // The message only: a stack can carry a connection string's parts.
      console.error(`revoke-links failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  )
  .finally(() => closePool());
