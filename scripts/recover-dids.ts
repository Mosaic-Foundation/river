// `npm run recover-dids`: re-keys DIDs with Mosaic's offline recovery key (spec 4.6, check 37).
// Adam runs it on his own machine, never on a server.
//
//   npm run recover-dids -- --key-file /outside/the/repo/recovery.pem --code abcdefgh [--code …]
//   npm run recover-dids -- --key-file /outside/the/repo/recovery.pem --all
//   npm run recover-dids -- --print-public-key [--key-file …]   (the value for IDENTITY_RECOVERY_PUBLIC_KEY)
//
// Without --key-file it asks for the PEM on the terminal. The private key is never read from the
// repository or from an environment variable. The database and the master key that wraps the new
// custodial keys come from DATABASE_URL (as identity_app) and IDENTITY_MASTER_KEY, read through
// src/config/env.ts; put them in .env.recover (gitignored) or the shell. After a lost master key,
// generate and deploy the new IDENTITY_MASTER_KEY first, then run this with it.
import { parseArgs } from "node:util";
import { closePool } from "../src/db/pool.js";
import { recoveryKeyFromFile, recoveryKeyFromPrompt, type RecoveryKey } from "../src/identity/recovery/key.js";
import { allPersonCodes, recoverPerson } from "../src/identity/recovery/recoverDids.js";

const USAGE = `Usage:
  npm run recover-dids -- [--key-file <path outside the repo>] (--code <code> ... | --all)
  npm run recover-dids -- --print-public-key [--key-file <path>]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "key-file": { type: "string" },
      code: { type: "string", multiple: true },
      all: { type: "boolean", default: false },
      "print-public-key": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const codes = values.code ?? [];
  if (!values["print-public-key"] && (values.all === (codes.length > 0))) {
    console.error(USAGE);
    return 2;
  }

  const keyFile = values["key-file"];
  const key: RecoveryKey = keyFile ? await recoveryKeyFromFile(keyFile) : await recoveryKeyFromPrompt();
  if (values["print-public-key"]) {
    console.log(key.multikey);
    return 0;
  }

  const targets = values.all ? await allPersonCodes() : codes;
  let failed = 0;
  for (const code of targets) {
    try {
      const done = await recoverPerson(code, key);
      console.log(`${code}: ${done.did} now at version ${done.versionNumber}, new key ${done.newKey}`);
    } catch (err) {
      failed += 1;
      console.error(`${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`${targets.length - failed} recovered, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    await closePool();
    process.exitCode = code;
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    await closePool();
    process.exitCode = 1;
  });
