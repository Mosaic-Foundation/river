// Creating a person (spec F2, 4.6) and signing the River's sign-in note for one (spec 4.6 step 3).
import { randomBytes, randomUUID } from "node:crypto";
import { forIdentity, type ClientSource, type Db } from "../db/context.js";
import { audit } from "./audit.js";
import { createPersonDid } from "./did/index.js";
import { kidFor, newPersonKey, signAsPerson } from "./keys/index.js";
import { noteRedirect, notePayload, signNote } from "./note.js";
import type { RegisteredCredential } from "./passkeys.js";
import {
  appendDidLog,
  consumeAuthRequest,
  createToken,
  insertPasskey,
  lookups,
  randomCode,
  type AuthRequest,
  type Person,
} from "./store.js";

/** The address already belongs to a Mosaic ID. */
export class EmailInUseError extends Error {
  constructor() {
    super("That address already has a Mosaic ID");
    this.name = "EmailInUseError";
  }
}

/** The auth request was used or expired between the two steps of its ceremony. */
export class RequestGoneError extends Error {
  constructor() {
    super("This sign-in request has expired or was already used");
    this.name = "RequestGoneError";
  }
}

export function newWebauthnUserId(): Buffer {
  return randomBytes(32);
}

export interface NewPerson {
  origin: string;
  recoveryMultikey: string;
  email: string;
  displayName?: string;
  webauthnUserId: Buffer;
  credential: RegisteredCredential;
  /** The sign-up's authorize request; it is marked used before anything is signed. */
  requestId: string;
  now: Date;
}

export interface CreatedPerson {
  person: Pick<Person, "id" | "code" | "did" | "scid" | "email">;
  /** The emailed verification token (verify_email, 24 hours). */
  verifyToken: string;
  /** redirect_uri?state=…&note=… when the request came from a River client. */
  redirect?: string;
}

/**
 * One transaction: mark the request used, create the person's key, DID and first log entry,
 * store the person, the sealed key, the log entry and the passkey, audit it all, create the email
 * verification token and sign the note. Any failure rolls all of it back.
 */
export async function createPerson(input: NewPerson, source?: ClientSource): Promise<CreatedPerson> {
  const personId = randomUUID();
  const code = await forIdentity({}, async (db) => {
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode();
      if ((await lookups.personByCode(db, candidate)) === undefined) return candidate;
    }
    throw new Error("Could not find a free person code");
  }, source);

  try {
    return await forIdentity({ personId, authRequestId: input.requestId }, async (db) => {
      const { rows } = await db.query<AuthRequest>("SELECT * FROM identity.auth_requests WHERE id = $1", [input.requestId]);
      const request = rows[0];
      if (!request || !(await consumeAuthRequest(db, input.requestId, input.now))) throw new RequestGoneError();

      const key = newPersonKey();
      const created = await createPersonDid({
        origin: input.origin,
        code,
        personMultikey: key.multikey,
        recoveryMultikey: input.recoveryMultikey,
        sign: (data) => key.sign("did_log", data),
        created: input.now,
      });

      await db.query(
        `INSERT INTO identity.people (id, code, did, scid, display_name, webauthn_user_id, email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [personId, code, created.did, created.scid, input.displayName ?? null, input.webauthnUserId, input.email, input.now],
      );
      await key.store(db, personId, created.did, input.now);
      await appendDidLog(db, personId, 1, created.log[0], input.now);
      await audit(db, personId, "did_created", { did: created.did }, input.now);
      await insertPasskey(db, personId, input.credential, input.now);
      await audit(db, personId, "passkey_added", { via: "signup" }, input.now);
      const verifyToken = await createToken(db, { personId, purpose: "verify_email", email: input.email, now: input.now });

      const person = { id: personId, code, did: created.did, scid: created.scid, email: input.email };
      const redirect = request.client_id ? await signInRedirect(db, person, request, input.now) : undefined;
      return { person, verifyToken, redirect };
    }, source);
  } catch (err) {
    if ((err as { code?: string; constraint?: string }).code === "23505" &&
        (err as { constraint?: string }).constraint === "people_email_key") {
      throw new EmailInUseError();
    }
    throw err;
  }
}

/**
 * Signs the River's note for a person and an authorize request that the caller has already
 * marked used, audits the sign-in, and returns the redirect. Runs in the person's context.
 */
export async function signInRedirect(
  db: Db,
  person: { id: string; did: string },
  request: Pick<AuthRequest, "client_id" | "redirect_uri" | "state" | "nonce">,
  now: Date,
): Promise<string> {
  if (!request.client_id || !request.redirect_uri || !request.state || !request.nonce) {
    throw new Error("This request has no client to return to");
  }
  const payload = notePayload(person.did, request.client_id, request.nonce, now);
  const note = await signNote(kidFor(person.did), payload, (data) =>
    signAsPerson(db, person, "signin_note", data, now),
  );
  await audit(db, person.id, "signin", { client: request.client_id }, now);
  return noteRedirect(request.redirect_uri, request.state, note);
}
