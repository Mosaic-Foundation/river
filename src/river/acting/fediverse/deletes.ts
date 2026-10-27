// Deleting a post or reply made from the River (fediverse-posting-1.md items 2.4 and 4; ADR-010
// §7, §8). From Your activity: the delete is an act of its own (verb `delete`, pointing at the
// original), counted against ADR-010 §9's delete limit, and sent as
// `DELETE https://{server}/api/v1/statuses/{id}` with the member's token. The fetch guard never
// follows a redirect for a DELETE. Once the server confirms (or says the post is already gone),
// the original reads `undone` and its stored request, the member's text, is erased at once.
// Mastodon answers with the deleted text; the River doesn't keep it.
import { forAccount } from "../../../db/context.js";
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { ActRefused, finishAct, startToggle, type Actor } from "../acts.js";
import { loadLink, PostError, postMessage, type PostErrorCode } from "./posts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DeleteResult {
  id: string;
  status: "sent" | "failed" | "unknown";
  error: PostErrorCode | null;
  message: string;
  retryAt: string | null;
}

interface Original {
  id: string;
  linked_account_id: string | null;
  remote_id: string | null;
  subject_title: string | null;
}

/** The deleted-copies note (item 4). */
export function deletedMessage(host: string): string {
  return `Deleted on ${host}. Other servers are asked to delete their copies; some may keep them.`;
}

export async function deletePost(guard: FetchGuard, actor: Actor, originalId: string, at = new Date()): Promise<DeleteResult> {
  const notDeletable = new PostError("bad_input", "That isn't a post from the River you can delete.");
  if (!UUID.test(originalId)) throw notDeletable;
  const original = await forAccount(actor.instanceId, actor.accountId, async (db) => {
    const { rows } = await db.query<Original>(
      `SELECT id, linked_account_id, remote_id, subject_title FROM river.member_actions
        WHERE id = $1 AND channel = 'fediverse' AND verb IN ('post', 'reply') AND status = 'sent'`,
      [originalId],
    );
    return rows[0];
  });
  if (!original?.linked_account_id || !original.remote_id || !/^[A-Za-z0-9_-]{1,64}$/.test(original.remote_id)) throw notDeletable;
  const link = await loadLink(actor, original.linked_account_id);
  const url = `https://${link.host}/api/v1/statuses/${original.remote_id}`;

  let act;
  try {
    act = await startToggle(
      actor,
      {
        channel: "fediverse",
        verb: "delete",
        linkedAccountId: link.id,
        targetHost: link.host,
        targetLabel: link.handle,
        undoesId: original.id,
        ...(original.subject_title ? { subjectTitle: original.subject_title } : {}),
        request: { method: "DELETE", url },
      },
      at,
    );
  } catch (err) {
    if (err instanceof ActRefused) {
      if (err.code === "limit") {
        throw new PostError("limit", "You've deleted a lot from the River just now. Try again later.", err.retryAt);
      }
      if (err.code === "session_ended") throw new PostError("session_ended", postMessage("session_ended", link.host, link.handle));
      throw new PostError("no_link", "That account isn't linked any more. Link it again in Settings → Linked accounts.");
    }
    throw err;
  }

  const result = async (status: DeleteResult["status"], code: PostErrorCode | null, message: string, retryAt?: Date) => {
    await finishAct(actor, act.id, { status, ...(code ? { errorCode: code } : {}) });
    return { id: act.id, status, error: code, message, retryAt: retryAt?.toISOString() ?? null };
  };

  let res: Response;
  try {
    res = await guard.fetch(url, {
      method: "DELETE",
      headers: { authorization: `Bearer ${link.token}`, accept: "application/json" },
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "timeout") return result("unknown", null, postMessage("unknown", link.host, link.handle));
    if (err instanceof FetchError && err.code === "retry_later") {
      return result("failed", "rate_limited", postMessage("rate_limited", link.host, link.handle), new Date(err.retryAt ?? Date.now()));
    }
    return result("failed", "unreachable", postMessage("unreachable", link.host, link.handle));
  }
  // The answer carries the deleted text: read it to the end and drop it.
  await res.body?.cancel();

  if (res.status === 200 || res.status === 404) {
    // 404: the post is already gone there, which is what the member asked for.
    await forAccount(actor.instanceId, actor.accountId, (db) =>
      db.query("UPDATE river.member_actions SET status = 'undone', request = NULL WHERE id = $1 AND status = 'sent'", [original.id]),
    );
    return result("sent", null, deletedMessage(link.host));
  }
  if (res.status === 401) {
    await forAccount(actor.instanceId, actor.accountId, (db) =>
      db.query(
        `UPDATE river.linked_accounts
            SET status = 'revoked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now()
          WHERE id = $1 AND status = 'active'`,
        [link.id],
      ),
    );
    return result("failed", "revoked", postMessage("revoked", link.host, link.handle));
  }
  if (res.status === 403) return result("failed", "scope", postMessage("scope", link.host, link.handle));
  if (res.status === 429) {
    const header = res.headers.get("retry-after");
    const seconds = header && /^\d+$/.test(header) ? Number(header) : undefined;
    return result(
      "failed",
      "rate_limited",
      postMessage("rate_limited", link.host, link.handle),
      seconds ? new Date(Date.now() + seconds * 1000) : undefined,
    );
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) return result("unknown", null, postMessage("unknown", link.host, link.handle));
  return result("failed", "unreachable", postMessage("unreachable", link.host, link.handle));
}
