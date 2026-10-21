// Outgoing email (spec 4.6, Appendix D). EMAIL_TRANSPORT picks one of three transports:
//   log      one redacted line per email: its kind and the masked address, never a link or token
//   capture  kept in this process's memory for tests, read through the TEST_ROUTES mailbox route
//   resend   POST https://api.resend.com/emails through the fetch guard (ADR-001 allows that host
//            for the identity host only). No test ever calls it.
// Sending never throws into a request: a failure is logged (redacted) and the flow goes on, since
// every email can be asked for again.
import { env } from "../../config/env.js";
import { getFetchGuard, type FetchGuard } from "../../shared/fetch/index.js";
import { maskEmail } from "./address.js";

export type EmailKind = "verify_email" | "recover" | "recovery_notice" | "email_change_notice";

export interface OutgoingEmail {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
}

export interface CapturedEmail extends OutgoingEmail {
  at: string;
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

const captured: CapturedEmail[] = [];
const CAPTURE_LIMIT = 500;

export function capturedEmails(): readonly CapturedEmail[] {
  return captured;
}

export function clearCapturedEmails(): void {
  captured.length = 0;
}

/** The one log line the `log` transport writes. Exported for tests. */
export function redactedLine(email: OutgoingEmail): string {
  return `email kind=${email.kind} to=${maskEmail(email.to)}`;
}

export async function sendEmail(email: OutgoingEmail, guard?: FetchGuard): Promise<boolean> {
  try {
    switch (env.emailTransport) {
      case "log":
        console.log(redactedLine(email));
        return true;
      case "capture":
        captured.push({ ...email, at: new Date().toISOString() });
        if (captured.length > CAPTURE_LIMIT) captured.splice(0, captured.length - CAPTURE_LIMIT);
        return true;
      case "resend":
        await sendWithResend(email, guard ?? getFetchGuard());
        return true;
    }
  } catch (err) {
    // The error's message may quote the request; log only what failed and for whom (masked).
    const code = (err as { code?: unknown }).code;
    console.error(`${redactedLine(email)} failed${typeof code === "string" ? ` (${code})` : ""}`);
    return false;
  }
}

export async function sendWithResend(email: OutgoingEmail, guard: FetchGuard): Promise<void> {
  const res = await guard.fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.emailFrom, to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw Object.assign(new Error("Resend refused the email"), { code: `http_${res.status}` });
  }
  await res.body?.cancel();
}
