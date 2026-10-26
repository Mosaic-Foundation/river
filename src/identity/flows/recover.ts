// "Lost your passkey?" (spec 4.6, check 36): an emailed, single-use, 15-minute link that adds a new
// passkey to the same person and DID, then continues the sign-in it started from.
//
//   GET  /recover?request=        the form (request: the authorize request it came from, if any)
//   POST /recover                 always "If that address has an account, we sent a link"
//   GET  /recover/link?token=     the link's page, or "expired or already used"
//   POST /recover/options {token}             registration options for the person's user handle
//   POST /recover/verify  {request, response}  new passkey → {redirect} or {done}
//
// Rate limits: per IP, and per IP and address together (in memory), and at most 3 links an hour
// per person (in the database). An unknown or unverified address gets the same answer and no
// email, in the same time: the lookup and the email happen after the answer (waitUntil on
// Vercel), so a known address doesn't take longer. The token
// is consumed in the same transaction that adds the passkey, so a link that fails halfway still
// works; once a passkey is added it never works again.
import { createHash, randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { forIdentity } from "../../db/context.js";
import { audit } from "../audit.js";
import { identityNow } from "../clock.js";
import { identityConfig } from "../config.js";
import { normalizeEmail } from "../email/address.js";
import { sendEmail } from "../email/index.js";
import { recoverMessage, recoveryNoticeMessage } from "../email/messages.js";
import { clientIp } from "../http.js";
import { registrationOptions, verifyRegistration } from "../passkeys.js";
import { LINK_GONE, RECOVER_SENT, linkGonePage, recoverLinkPage, recoverPage } from "../pages.js";
import { signInRedirect } from "../people.js";
import { hit } from "../rateLimit.js";
import {
  consumeAuthRequest,
  consumeToken,
  createToken,
  getPerson,
  hashToken,
  insertAuthRequest,
  insertPasskey,
  liveAuthRequest,
  liveToken,
  lookups,
  randomToken,
  tokenParam,
  tokensSince,
  uuidParam,
  type AuthRequest,
} from "../store.js";
import { MESSAGES, allow, fail, type Routes } from "./common.js";

/** At most this many recovery links per person per hour, counted in the database. */
export const RECOVER_PER_PERSON_PER_HOUR = 3;

const AGAIN = { href: "/recover", label: "Ask for a new link" };

export function recoverRoutes(router: Routes): void {
  router.get("/recover", (req, res) => {
    res.type("html").send(recoverPage(uuidParam(req.query.request)));
  });

  router.post("/recover", async (req, res) => {
    if (!allow(req, res, "recoverIp", true)) return;
    const requestId = uuidParam(req.body?.request);
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      res.status(400).type("html").send(recoverPage(requestId, MESSAGES.invalidEmail));
      return;
    }
    // Per address, known or not, so the limit itself says nothing about who has an account; and
    // per IP too, so requests from elsewhere can't use up the owner's own allowance.
    const ip = clientIp(req);
    if (hit("recoverAddress", recoverAddressKey(ip, email))) {
      // Not awaited: the answer goes out at once whether or not the address has an account.
      waitUntil(
        sendRecoveryLink(email, requestId, ip).catch((err: unknown) => {
          console.error(`Recovery link failed: ${err instanceof Error ? err.name : "error"}`);
        }),
      );
    }
    res.type("html").send(recoverPage(requestId, RECOVER_SENT));
  });

  router.get("/recover/link", async (req, res) => {
    if (!allow(req, res, "links", true)) return;
    const token = tokenParam(req.query.token);
    const live = token ? await findLiveToken(token) : undefined;
    if (!token || !live) {
      res.status(410).type("html").send(linkGonePage(AGAIN));
      return;
    }
    res.type("html").send(recoverLinkPage(token));
  });

  router.post("/recover/options", async (req, res) => {
    if (!allow(req, res, "links")) return;
    const config = identityConfig();
    const token = tokenParam(req.body?.token);
    const live = token ? await findLiveToken(token) : undefined;
    if (!token || !live) return fail(res, 410, "link_gone", LINK_GONE);
    const { personId, tokenId, authRequestId } = live;

    // Continue the sign-in the person started, if that request is still open.
    const origin: AuthRequest | undefined = authRequestId
      ? await forIdentity({ authRequestId }, (db) => liveAuthRequest(db, authRequestId, identityNow()))
      : undefined;
    const client =
      origin?.purpose === "authorize" && origin.client_id && origin.redirect_uri && origin.state && origin.nonce
        ? { clientId: origin.client_id, redirectUri: origin.redirect_uri, state: origin.state, nonce: origin.nonce }
        : undefined;

    const id = randomUUID();
    const challenge = randomToken();
    const person = await forIdentity({ personId, authRequestId: id }, async (db) => {
      const found = await getPerson(db, personId);
      if (!found) return undefined;
      await insertAuthRequest(db, {
        id,
        purpose: "recover",
        client,
        personId,
        pending: { token_id: tokenId },
        challenge,
        now: identityNow(),
      });
      return found;
    });
    if (!person) return fail(res, 410, "link_gone", LINK_GONE);
    res.json({
      request: id,
      options: await registrationOptions({
        rpId: config.rpId,
        challenge,
        userId: person.webauthn_user_id,
        userName: person.email,
        displayName: person.display_name ?? person.email,
      }),
    });
  });

  router.post("/recover/verify", async (req, res) => {
    if (!allow(req, res, "links")) return;
    const config = identityConfig();
    const id = uuidParam(req.body?.request);
    if (!id) return fail(res, 400, "bad_request", MESSAGES.gone);
    const now = identityNow();
    const request = await forIdentity({ authRequestId: id }, (db) => liveAuthRequest(db, id, now));
    const tokenId = request?.pending.token_id;
    if (!request || request.purpose !== "recover" || !request.person_id || !tokenId) {
      return fail(res, 410, "request_gone", MESSAGES.gone);
    }
    const personId = request.person_id;
    const credential = await verifyRegistration({
      response: req.body?.response,
      challenge: request.webauthn_challenge,
      origin: config.origin,
      rpId: config.rpId,
    });
    if (!credential) return fail(res, 400, "passkey_failed", MESSAGES.passkeyFailed);

    const result = await forIdentity({ personId, authRequestId: id }, async (db) => {
      if (!(await consumeAuthRequest(db, id, now))) return { error: "request_gone" } as const;
      if (!(await consumeToken(db, tokenId, now))) return { error: "link_gone" } as const;
      const person = await getPerson(db, personId, true);
      if (!person) return { error: "link_gone" } as const;
      await insertPasskey(db, personId, credential, now);
      await audit(db, personId, "passkey_added", { via: "recovery" }, now);
      await audit(db, personId, "recovered", { token: tokenId }, now);
      const redirect = request.client_id ? await signInRedirect(db, person, request, now) : undefined;
      return { email: person.email, redirect };
    });
    if (result.error !== undefined) {
      // Nothing was written: the transaction committed no passkey.
      return fail(res, 410, result.error, result.error === "link_gone" ? LINK_GONE : MESSAGES.gone);
    }
    await sendEmail(recoveryNoticeMessage(result.email));
    res.json(result.redirect ? { redirect: result.redirect } : { done: true });
  });
}

/** The per-address recovery limit's key: the IP and the address together, hashed. */
export function recoverAddressKey(ip: string, email: string): string {
  return createHash("sha256").update(`${ip}\n${email}`).digest("base64url");
}

async function findLiveToken(
  token: string,
): Promise<{ personId: string; tokenId: string; authRequestId?: string } | undefined> {
  const personId = await forIdentity({}, (db) => lookups.personByToken(db, hashToken(token)));
  if (!personId) return undefined;
  const row = await forIdentity({ personId }, (db) => liveToken(db, token, "recover", identityNow()));
  return row ? { personId, tokenId: row.id, authRequestId: row.auth_request_id ?? undefined } : undefined;
}

/** Sends a link when the address is a verified person's and they are under the hourly cap. */
async function sendRecoveryLink(email: string, requestId: string | undefined, ip: string): Promise<void> {
  const personId = await forIdentity({}, (db) => lookups.personForRecovery(db, email));
  if (!personId) return;
  const now = identityNow();
  const token = await forIdentity({ personId }, async (db) => {
    const recent = await tokensSince(db, personId, "recover", new Date(now.getTime() - 60 * 60_000));
    if (recent >= RECOVER_PER_PERSON_PER_HOUR) return undefined;
    const created = await createToken(db, { personId, purpose: "recover", authRequestId: requestId, now });
    await audit(db, personId, "recovery_requested", { ip_hash: createHash("sha256").update(ip).digest("hex").slice(0, 16) }, now);
    return created;
  });
  if (!token) return;
  await sendEmail(recoverMessage(email, `${identityConfig().origin}/recover/link?token=${token}`));
}
