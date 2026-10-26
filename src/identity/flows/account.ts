// The account page (HANDOFF, 2026-10-26): a Mosaic ID's recovery address and passkeys, shown after
// a fresh passkey check. The identity host keeps no session, so every look is its own ceremony,
// like changing the address (email.ts). Adding or changing the address links to /account/email.
//
//   GET  /account                                 the page, with one button
//   POST /account/options                         fresh passkey check: authentication options
//   POST /account/verify   {request, response}    the account: name, DID, address and whether it
//                                                 is confirmed, passkeys with added and last-used dates
//
// The address goes only to whoever just proved they hold one of the Mosaic ID's passkeys, in a
// no-store answer (http.ts), and is never logged.
import { randomUUID } from "node:crypto";
import { forIdentity } from "../../db/context.js";
import { identityNow } from "../clock.js";
import { identityConfig } from "../config.js";
import { authenticationOptions, assertionCredentialId, verifyAssertion } from "../passkeys.js";
import { accountPage } from "../pages.js";
import {
  consumeAuthRequest,
  getPasskey,
  getPerson,
  insertAuthRequest,
  liveAuthRequest,
  lookups,
  passkeysOf,
  randomToken,
  touchPasskey,
  uuidParam,
} from "../store.js";
import { MESSAGES, allow, fail, type Routes } from "./common.js";

/** What the account page shows. Dates are YYYY-MM-DD (UTC). */
export interface AccountView {
  displayName: string | null;
  did: string;
  email: string | null;
  emailConfirmed: boolean;
  passkeys: Array<{ added: string; lastUsed: string | null; current: boolean }>;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

export function accountRoutes(router: Routes): void {
  router.get("/account", (_req, res) => {
    res.type("html").send(accountPage());
  });

  router.post("/account/options", async (req, res) => {
    if (!allow(req, res, "links")) return;
    const id = randomUUID();
    const challenge = randomToken();
    try {
      await forIdentity({ authRequestId: id }, (db) =>
        insertAuthRequest(db, { id, purpose: "account", challenge, now: identityNow() }),
      );
    } catch (err) {
      // The purpose 'account' arrives with migration 20261026214500, which may land after the code.
      if ((err as { code?: string }).code === "23514") {
        return fail(res, 503, "not_ready", "This page isn't ready yet. Try again in a few minutes.");
      }
      throw err;
    }
    res.json({ request: id, options: await authenticationOptions({ rpId: identityConfig().rpId, challenge }) });
  });

  router.post("/account/verify", async (req, res) => {
    if (!allow(req, res, "links")) return;
    const config = identityConfig();
    const id = uuidParam(req.body?.request);
    const credentialId = assertionCredentialId(req.body?.response);
    if (!id || !credentialId) return fail(res, 400, "bad_request", MESSAGES.passkeyFailed);
    const personId = await forIdentity({}, (db) => lookups.personByCredential(db, credentialId));
    if (!personId) return fail(res, 400, "unknown_passkey", MESSAGES.unknownPasskey);

    const now = identityNow();
    const result = await forIdentity({ personId, authRequestId: id }, async (db) => {
      const request = await liveAuthRequest(db, id, now);
      if (!request || request.purpose !== "account") return { error: "request_gone" } as const;
      const passkey = await getPasskey(db, credentialId);
      if (!passkey) return { error: "unknown_passkey" } as const;
      const counter = await verifyAssertion({
        response: req.body.response,
        challenge: request.webauthn_challenge,
        origin: config.origin,
        rpId: config.rpId,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: Number(passkey.counter),
          transports: passkey.transports,
        },
      });
      if (counter === undefined) return { error: "passkey_failed" } as const;
      if (!(await consumeAuthRequest(db, id, now))) return { error: "request_gone" } as const;
      await touchPasskey(db, passkey.id, counter, now);
      const person = await getPerson(db, personId);
      if (!person) return { error: "unknown_passkey" } as const;
      const passkeys = await passkeysOf(db, personId, credentialId);
      const account: AccountView = {
        displayName: person.display_name,
        did: person.did,
        email: person.email,
        emailConfirmed: person.email !== null && person.email_verified_at !== null,
        passkeys: passkeys.map((p) => ({
          added: day(p.created_at),
          lastUsed: p.last_used_at ? day(p.last_used_at) : null,
          current: p.current,
        })),
      };
      return { account } as const;
    });

    if (result.error !== undefined) {
      const messages: Record<string, [number, string]> = {
        request_gone: [410, MESSAGES.gone],
        unknown_passkey: [400, MESSAGES.unknownPasskey],
        passkey_failed: [400, MESSAGES.passkeyFailed],
      };
      const [status, message] = messages[result.error];
      return fail(res, status, result.error, message);
    }
    res.json({ account: result.account });
  });
}
