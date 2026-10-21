// The identity host's audit log (spec 3.2, Appendix B): every key use, sign-in, new passkey,
// recovery and email change. Details hold ids and purposes, never keys, tokens, notes or full
// email addresses.
import type { Db } from "../db/context.js";

export type AuditAction =
  | "did_created"
  | "key_used"
  | "passkey_added"
  | "signin"
  | "recovery_requested"
  | "recovered"
  | "email_verified"
  | "email_change_requested"
  | "did_recovered";

export async function audit(
  db: Db,
  personId: string,
  action: AuditAction,
  detail: Record<string, string | number | boolean | null>,
  at: Date,
): Promise<void> {
  await db.query(
    "INSERT INTO identity.audit_log (person_id, action, at, detail) VALUES ($1, $2, $3, $4)",
    [personId, action, at, JSON.stringify(detail)],
  );
}
