// Email verification and change (spec 4.6, check 35).
//
//   GET  /verify?token=            a page with one button (mail scanners that open links don't use them up)
//   POST /verify       token       marks the address verified (and makes a new address the recovery
//                                  address); works once, for 24 hours
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
import { emailChangeNoticeMessage, verifyEmailMessage } from "../email/messages.js";
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
    if (!token || !live) {
      res.status(410).type("html").send(linkGonePage(AGAIN));
      return;
    }
    res.type("html").send(verifyPage(token));
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
          .send(errorPage("That address is taken", "Another Mosaic ID started using that address. Choose a different one."));
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
      if (!same && (await lookups.emailInUse(db, newEmail))) return { error: "email_in_use" } as const;

      // Only the newest link works: earlier ones (for this or another address) stop working.
      await db.query(
        "UPDATE identity.recovery_tokens SET used_at = $2 WHERE person_id = $1 AND purpose = 'verify_email' AND used_at IS NULL",
        [personId, now],
      );
      const token = await createToken(db, { personId, purpose: "verify_email", email: newEmail, now });
      if (!same) await audit(db, personId, "email_change_requested", { to: maskEmail(newEmail) }, now);
      return { token, newEmail, oldEmail: same ? undefined : person.email } as const;
    });

    if (result.error !== undefined) {
      const messages: Record<string, [number, string]> = {
        request_gone: [410, MESSAGES.gone],
        unknown_passkey: [400, MESSAGES.unknownPasskey],
        passkey_failed: [400, MESSAGES.passkeyFailed],
        email_in_use: [409, MESSAGES.emailInUse],
      };
      const [status, message] = messages[result.error];
      return fail(res, status, result.error, message);
    }
    if (result.message !== undefined) {
      res.json({ message: result.message });
      return;
    }
    await sendEmail(verifyEmailMessage(result.newEmail, `${config.origin}/verify?token=${result.token}`));
    if (result.oldEmail) await sendEmail(emailChangeNoticeMessage(result.oldEmail, maskEmail(result.newEmail)));
    res.json({ message: `We sent a link to ${maskEmail(result.newEmail)}. Your address changes once you open it.` });
  });
}

async function personForToken(token: string): Promise<string | undefined> {
  return forIdentity({}, (db) => lookups.personByToken(db, hashToken(token)));
}
