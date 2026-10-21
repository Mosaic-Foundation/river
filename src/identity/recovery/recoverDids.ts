// recover-dids (spec 4.6, check 37): when the master key or a person's custodial key is lost,
// give the person a new custodial key and append a DID log entry, signed by Mosaic's recovery key,
// that makes the new key the update key and the authentication key #key-1. The DID (and its
// SCID), the person, their passkeys and their email stay the same, so they sign in as before.
//
// Each person is one transaction holding a row lock on the person: the old key is retired, the new
// one sealed under the (current) master key, the entry appended and audited. The whole new log is
// verified with the library before the transaction commits.
import { forIdentity, type ClientSource } from "../../db/context.js";
import { audit } from "../audit.js";
import { appendKeyRotation, parseJsonl, verifyLog } from "../did/index.js";
import { kidFor, replacePersonKey } from "../keys/index.js";
import { appendDidLog, getPerson, lookups, readDidLog } from "../store.js";
import type { RecoveryKey } from "./key.js";

export interface Recovered {
  code: string;
  did: string;
  scid: string;
  versionNumber: number;
  newKey: string;
}

export async function recoverPerson(
  code: string,
  recoveryKey: RecoveryKey,
  options: { now?: Date; source?: ClientSource } = {},
): Promise<Recovered> {
  if (!/^[a-z2-7]{8}$/.test(code)) throw new Error(`Not a person code: ${JSON.stringify(code)}`);
  const personId = await forIdentity({}, (db) => lookups.personByCode(db, code), options.source);
  if (!personId) throw new Error(`No person has the code ${code}`);
  const now = options.now ?? new Date();

  return forIdentity({ personId }, async (db) => {
    const person = await getPerson(db, personId, true);
    if (!person) throw new Error(`No person has the code ${code}`);
    const log = parseJsonl((await readDidLog(db, personId)).join("\n"));
    const before = await verifyLog(log);
    if (!before.meta.updateKeys.includes(recoveryKey.multikey)) {
      throw new Error(`${person.did} doesn't list this recovery key as an update key`);
    }

    const newKey = await replacePersonKey(db, personId, person.did, now);
    const { log: updated, entry } = await appendKeyRotation({
      log,
      signerMultikey: recoveryKey.multikey,
      sign: (data) => recoveryKey.sign(data),
      newMultikey: newKey,
      recoveryMultikey: recoveryKey.multikey,
      updated: now,
    });
    const after = await verifyLog(updated);
    if (after.meta.scid !== before.meta.scid || after.did !== person.did) {
      throw new Error("The new entry changed the DID; nothing was written");
    }
    const versionNumber = updated.length;
    await appendDidLog(db, personId, versionNumber, entry, now);
    await audit(db, personId, "did_recovered", { version: versionNumber, key: kidFor(person.did) }, now);
    return { code, did: person.did, scid: person.scid, versionNumber, newKey };
  }, options.source);
}

/** Every person's code, for `--all` (after a lost master key, everyone is affected). */
export async function allPersonCodes(source?: ClientSource): Promise<string[]> {
  return forIdentity({}, (db) => lookups.personCodes(db), source);
}
