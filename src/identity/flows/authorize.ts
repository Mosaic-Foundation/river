// The authorize page (spec 4.6 steps 2 and 3, F2, F3): the River sends people here; they sign in
// with a passkey or create a Mosaic ID, and come back with a signed note.
//
//   GET  /authorize?client_id&redirect_uri&state&nonce   exact client check, auth_requests row, page
//   POST /authorize/signin/options  {request}             authentication options (fresh challenge)
//   POST /authorize/signin/verify   {request, response}   assertion → note → {redirect}
//   POST /authorize/signup/options  {request, email, display_name}  registration options
//   POST /authorize/signup/verify   {request, response}   registration → person, DID → {redirect}
//
// Sign-up answers the same whether or not the address belongs to someone (security review of
// 3a86e8f, item 5): only a verified address is reserved, and it is checked after the passkey is
// made. A taken address gets a notice instead of a confirm link; the new Mosaic ID works but can't
// use that address, which the daily job releases from it 24 hours on.
import { randomUUID } from "node:crypto";

import { forIdentity } from "../../db/context.js";
import { identityNow } from "../clock.js";
import { findClient, identityConfig } from "../config.js";
import { maskEmail, normalizeEmail } from "../email/address.js";
import { sendEmail } from "../email/index.js";
import { signupAttemptMessage, verifyEmailMessage } from "../email/messages.js";
import { authenticationOptions, assertionCredentialId, registrationOptions, verifyAssertion, verifyRegistration } from "../passkeys.js";
import { authorizePage, errorPage } from "../pages.js";
import { EmailInUseError, RequestGoneError, createPerson, newWebauthnUserId, signInRedirect } from "../people.js";
import {
  consumeAuthRequest,
  getPasskey,
  getPerson,
  insertAuthRequest,
  liveAuthRequest,
  lookups,
  randomToken,
  setChallenge,
  touchPasskey,
  uuidParam,
} from "../store.js";
import { MESSAGES, allow, displayNameParam, fail, opaqueParam, type Routes } from "./common.js";

export function authorizeRoutes(router: Routes): void {
  router.get("/authorize", async (req, res) => {
    if (!allow(req, res, "authorize", true)) return;
    const config = identityConfig();
    const client = findClient(config.clients, req.query.client_id, req.query.redirect_uri);
    const state = opaqueParam(req.query.state);
    const nonce = opaqueParam(req.query.nonce);
    if (!client || !state || !nonce) {
      // Never redirect on a bad request: the redirect_uri itself is untrusted (check 12).
      res
        .status(400)
        .type("html")
        .send(
          errorPage(
            "This sign-in link isn't valid",
            "The app that sent you here isn't registered with Mosaic ID, or its return address doesn't match exactly. Go back and try again.",
          ),
        );
      return;
    }
    const id = randomUUID();
    await forIdentity({ authRequestId: id }, (db) =>
      insertAuthRequest(db, {
        id,
        purpose: "authorize",
        client: { clientId: client.clientId, redirectUri: req.query.redirect_uri as string, state, nonce },
        challenge: randomToken(),
        now: identityNow(),
      }),
    );
    res.type("html").send(authorizePage(id, client.name));
  });

  router.post("/authorize/signin/options", async (req, res) => {
    if (!allow(req, res, "authorize")) return;
    const id = uuidParam(req.body?.request);
    if (!id) return fail(res, 400, "bad_request", MESSAGES.gone);
    const challenge = randomToken();
    const ok = await forIdentity({ authRequestId: id }, async (db) => {
      const request = await liveAuthRequest(db, id, identityNow());
      if (!request || request.purpose !== "authorize") return false;
      await setChallenge(db, id, challenge, {});
      return true;
    });
    if (!ok) return fail(res, 410, "request_gone", MESSAGES.gone);
    res.json({ options: await authenticationOptions({ rpId: identityConfig().rpId, challenge }) });
  });

  router.post("/authorize/signin/verify", async (req, res) => {
    if (!allow(req, res, "authorize")) return;
    const config = identityConfig();
    const id = uuidParam(req.body?.request);
    const credentialId = assertionCredentialId(req.body?.response);
    if (!id || !credentialId) return fail(res, 400, "bad_request", MESSAGES.passkeyFailed);

    const personId = await forIdentity({}, (db) => lookups.personByCredential(db, credentialId));
    if (!personId) return fail(res, 400, "unknown_passkey", MESSAGES.unknownPasskey);

    const now = identityNow();
    const result = await forIdentity({ personId, authRequestId: id }, async (db) => {
      const request = await liveAuthRequest(db, id, now);
      if (!request || request.purpose !== "authorize") return { error: "request_gone" } as const;
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
      // Marked used before anything is signed (spec 4.6).
      if (!(await consumeAuthRequest(db, id, now))) return { error: "request_gone" } as const;
      await touchPasskey(db, passkey.id, counter, now);
      const person = await getPerson(db, personId);
      if (!person) return { error: "unknown_passkey" } as const;
      const redirect = await signInRedirect(db, person, request, now);
      if (!person.email) return { redirect, noAddress: true };
      return { redirect, reminder: person.email_verified_at ? undefined : maskEmail(person.email) };
    });
    if (result.error !== undefined) {
      const status = result.error === "request_gone" ? 410 : 400;
      const message =
        result.error === "request_gone" ? MESSAGES.gone : result.error === "unknown_passkey" ? MESSAGES.unknownPasskey : MESSAGES.passkeyFailed;
      return fail(res, status, result.error, message);
    }
    res.json(result);
  });

  router.post("/authorize/signup/options", async (req, res) => {
    if (!allow(req, res, "signup")) return;
    const config = identityConfig();
    const id = uuidParam(req.body?.request);
    if (!id) return fail(res, 400, "bad_request", MESSAGES.gone);
    const email = normalizeEmail(req.body?.email);
    if (!email) return fail(res, 400, "invalid_email", MESSAGES.invalidEmail);
    const displayName = displayNameParam(req.body?.display_name);
    if (displayName === null) return fail(res, 400, "invalid_name", "Use up to 64 characters for your name.");

    const challenge = randomToken();
    const userId = newWebauthnUserId();
    const ok = await forIdentity({ authRequestId: id }, async (db) => {
      const request = await liveAuthRequest(db, id, identityNow());
      if (!request || request.purpose !== "authorize") return false;
      const pending: Record<string, string> = { email, user_id: userId.toString("base64url") };
      if (displayName) pending.display_name = displayName;
      await setChallenge(db, id, challenge, pending);
      return true;
    });
    if (!ok) return fail(res, 410, "request_gone", MESSAGES.gone);
    res.json({
      options: await registrationOptions({
        rpId: config.rpId,
        challenge,
        userId,
        userName: email,
        displayName: displayName ?? email,
      }),
    });
  });

  router.post("/authorize/signup/verify", async (req, res) => {
    if (!allow(req, res, "signup")) return;
    const config = identityConfig();
    const id = uuidParam(req.body?.request);
    if (!id) return fail(res, 400, "bad_request", MESSAGES.gone);
    const now = identityNow();
    const request = await forIdentity({ authRequestId: id }, (db) => liveAuthRequest(db, id, now));
    const email = request?.pending.email;
    const userId = request?.pending.user_id;
    if (!request || request.purpose !== "authorize" || !email || !userId) {
      return fail(res, 410, "request_gone", MESSAGES.gone);
    }
    const credential = await verifyRegistration({
      response: req.body?.response,
      challenge: request.webauthn_challenge,
      origin: config.origin,
      rpId: config.rpId,
    });
    if (!credential) return fail(res, 400, "passkey_failed", MESSAGES.passkeyFailed);

    try {
      const created = await createPerson({
        origin: config.origin,
        recoveryMultikey: config.recoveryMultikey,
        email,
        displayName: request.pending.display_name,
        webauthnUserId: Buffer.from(userId, "base64url"),
        credential,
        requestId: id,
        now,
      });
      // Checked now, not at step 1, so the answer never says whether an address is taken. Either
      // way one email goes out.
      const taken = await forIdentity({}, (db) => lookups.emailInUse(db, email));
      await sendEmail(
        taken
          ? signupAttemptMessage(email)
          : verifyEmailMessage(email, `${config.origin}/verify?token=${created.verifyToken}`, {
              displayName: request.pending.display_name,
              signup: true,
            }),
      );
      res.json({ redirect: created.redirect, reminder: maskEmail(email), did: created.person.did });
    } catch (err) {
      // Only before 20261026163500_email_reservation.sql, while people.email is still UNIQUE.
      if (err instanceof EmailInUseError) return fail(res, 409, "email_in_use", MESSAGES.emailInUse);
      if (err instanceof RequestGoneError) return fail(res, 410, "request_gone", MESSAGES.gone);
      throw err;
    }
  });
}
