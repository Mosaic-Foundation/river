// Email verification and change (spec 4.6, check 35).
//
//   GET  /verify?token=            a page with one button (mail scanners that open links don't use them up):
//                                  who is asking (the Mosaic ID's display name) and what to do if it
//                                  wasn't you, in the same words as the email
//   POST /verify       token       marks the address verified (and makes a new address the recovery
//                                  address); works once, for 24 hours. Refused when another Mosaic ID
//                                  verified the address meanwhile (only verified addresses are held)
//   GET  /account/email            the change-email page
//   POST /account/email/options {email}                fresh passkey check: authentication options
//   POST /account/email/verify  {request, response}    link to the new address, notice to the old
import { randomUUID } from "node:crypto";
import { forIdentity } from "../../db/context.js";
import { audit } from "../audit.js";
import { identityNow } from "../clock.js";
import { identityConfig } from "../config.js";
import { maskEmail, normalizeEmail } from "../email/address.js";
import { sendEmail } from "../email/index.js";
import { emailChangeNoticeMessage, signupAttemptMessage, verifyEmailMessage } from "../email/messages.js";
import { authenticationOptions, assertionCredentialId, verifyAssertion } from "../passkeys.js";
import { changeEmailPage, errorPage, linkGonePage, verifiedPage, verifyPage } from "../pages.js";
import {
  consumeAuthRequest,
  consumeToken,
  createToken,
  getPasskey,
  getPerson,
  hashToken,
  insertAuthRequest,
  liveAuthRequest,
  liveToken,
  lookups,
  randomToken,
  tokenParam,
  touchPasskey,
  uuidParam,
} from "../store.js";
import { MESSAGES, allow, fail, type Routes } from "./common.js";

const AGAIN = { href: "/account/email", label: "Send a new link" };

export function emailRoutes(router: Routes): void {
  router.get("/verify", async (req, res) => {
    if (!allow(req, res, "links", true)) return;
    const token = tokenParam(req.query.token);
    const personId = token ? await personForToken(token) : undefined;
    const live = token && personId
      ? await forIdentity({ personId }, (db) => liveToken(db, token, "verify_email", identityNow()))
      : undefined;
    const person = token && personId && live ? await forIdentity({ personId }, (db) => getPerson(db, personId)) : undefined;
    if (!token || !live || !person) {
      res.status(410).type("html").send(linkGonePage(AGAIN));
      return;
    }
    // A Mosaic ID that never had a confirmed address reads as a sign-up; one that had, as a move.
    res.type("html").send(verifyPage(token, { displayName: person.display_name, signup: !person.email_verified_at }));
  });

  router.post("/verify", async (req, res) => {
    if (!allow(req, res, "links", true)) return;
    const token = tokenParam(req.body?.token);
    const personId = token ? await personForToken(token) : undefined;
    if (!token || !personId) {
      res.status(410).type("html").send(linkGonePage(AGAIN));
      return;
    }
    const now = identityNow();
    try {
      const done = await forIdentity({ personId }, async (db) => {
        const row = await liveToken(db, token, "verify_email", now);
        if (!row?.email || !(await consumeToken(db, row.id, now))) return false;
        await db.query(
          "UPDATE identity.people SET email = $2, email_verified_at = $3 WHERE id = $1",
          [personId, row.email, now],
        );
        await audit(db, personId, "email_verified", { email: maskEmail(row.email) }, now);
        return true;
      });
      if (!done) {
        res.status(410).type("html").send(linkGonePage(AGAIN));
        return;
      }
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res
          .status(409)
          .type("html")
          .send(errorPage("That address is taken", "Another Mosaic ID confirmed that address first. Choose a different one."));
        return;
      }
      throw err;
    }
    res.type("html").send(verifiedPage());
  });

  router.get("/account/email", (_req, res) => {
    res.type("html").send(changeEmailPage());
  });

  router.post("/account/email/options", async (req, res) => {
    if (!allow(req, res, "links")) return;
    const email = normalizeEmail(req.body?.email);
    if (!email) return fail(res, 400, "invalid_email", MESSAGES.invalidEmail);
    const id = randomUUID();
    const challenge = randomToken();
    await forIdentity({ authRequestId: id }, (db) =>
      insertAuthRequest(db, { id, purpose: "change_email", pending: { email }, challenge, now: identityNow() }),
    );
    res.json({ request: id, options: await authenticationOptions({ rpId: identityConfig().rpId, challenge }) });
  });

  router.post("/account/email/verify", async (req, res) => {
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
      const newEmail = request?.pending.email;
      if (!request || request.purpose !== "change_email" || !newEmail) return { error: "request_gone" } as const;
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
      const person = await getPerson(db, personId, true);
      if (!person) return { error: "unknown_passkey" } as const;

      const same = newEmail === person.email;
      if (same && person.email_verified_at) return { message: "That is already your address, and it is confirmed." } as const;
      // Someone else's verified address gets the same answer as a free one, and a notice instead
      // of a link (security review item 5): this page mustn't tell anyone who has a Mosaic ID.
      const taken = await lookups.emailInUse(db, newEmail);

      // Only the newest link works: earlier ones (for this or another address) stop working.
      await db.query(
        "UPDATE identity.recovery_tokens SET used_at = $2 WHERE person_id = $1 AND purpose = 'verify_email' AND used_at IS NULL",
        [personId, now],
      );
      const token = taken ? undefined : await createToken(db, { personId, purpose: "verify_email", email: newEmail, now });
      if (!same) await audit(db, personId, "email_change_requested", { to: maskEmail(newEmail) }, now);
      return {
        token,
        newEmail,
        // The old address gets a notice only if there is one (a released address leaves none).
        oldEmail: same ? undefined : (person.email ?? undefined),
        displayName: person.display_name,
        verified: person.email_verified_at !== null,
      } as const;
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
    if (result.message !== undefined) {
      res.json({ message: result.message });
      return;
    }
    await sendEmail(
      result.token === undefined
        ? signupAttemptMessage(result.newEmail)
        : verifyEmailMessage(result.newEmail, `${config.origin}/verify?token=${result.token}`, {
            displayName: result.displayName,
            signup: !result.verified,
          }),
    );
    if (result.oldEmail) await sendEmail(emailChangeNoticeMessage(result.oldEmail, maskEmail(result.newEmail)));
    res.json({ message: `We sent a link to ${maskEmail(result.newEmail)}. Your address changes once you open it.` });
  });
}

async function personForToken(token: string): Promise<string | undefined> {
  return forIdentity({}, (db) => lookups.personByToken(db, hashToken(token)));
}
