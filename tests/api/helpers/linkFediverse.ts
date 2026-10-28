// Links a stand-in fediverse account for a member through the River's real routes: start, the
// stand-in's authorize page (approved as `username`), then the callback. SYNTHETIC: the stand-in
// server (tests/support/standInMastodon/) answers every request.
import { API, type Member } from "./member.js";
import { standIn } from "./standInFediverse.js";

/** Links `input` as `username`; returns the linked account's id. */
export async function linkFediverse(who: Member, input: string, username: string): Promise<string> {
  const started = await fetch(`${API}/linked-accounts/fediverse/start`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: who.origin, cookie: who.cookie },
    body: JSON.stringify({ input }),
  });
  if (started.status !== 200) throw new Error(`start answered ${started.status}: ${await started.text()}`);
  const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
  const linkCookie = (started.headers.getSetCookie().find((c) => c.startsWith("__Host-river-link=")) ?? "").split(";")[0] ?? "";
  const approved = await standIn.authorize(authorizeUrl, username);
  if (!approved.location) throw new Error(`stand-in refused: ${approved.error}`);
  const back = await fetch(`${API}/auth/fediverse/callback${new URL(approved.location).search}`, {
    redirect: "manual",
    headers: { cookie: `${who.cookie}; ${linkCookie}` },
  });
  if (back.headers.get("location") !== "/linked-accounts?link=linked") throw new Error(`callback: ${back.headers.get("location")}`);
  const list = (await (await fetch(`${API}/linked-accounts`, { headers: { cookie: who.cookie } })).json()) as {
    accounts: Array<{ id: string; handle: string }>;
  };
  const handle = input.startsWith("@") ? input : `@${username}@${new URL(input).host}`;
  const found = list.accounts.find((a) => a.handle === handle);
  if (!found) throw new Error(`no linked account ${handle}`);
  return found.id;
}
