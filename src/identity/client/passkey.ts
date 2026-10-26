// Browser script for the identity host's passkey pages, bundled by `npm run build:identity-client`
// into identity/public/passkey.js (spec Appendix A). The pages carry no inline script (Appendix B
// CSP); this reads each form's data-* attributes, runs the WebAuthn ceremony with
// @simplewebauthn/browser, and talks only to its own origin (connect-src 'self').
//
// Forms: #signin and #signup (authorize page), #recover (recovery link page), #change-email,
// #account (account page).
// Every message shown comes from the server's JSON or from here, set with textContent.
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

interface Answer {
  error?: string;
  message?: string;
  redirect?: string;
  reminder?: string;
  /** Signed in with a Mosaic ID that has no recovery address (it was released, never confirmed). */
  noAddress?: boolean;
  done?: boolean;
  /** After a recovery: how many passkeys the Mosaic ID has, and the others, to remove. */
  passkeys?: { total: number; others: Array<{ id: string; added: string; lastUsed: string | null }> };
  request?: string;
  /** The account page's answer (flows/account.ts AccountView). */
  account?: {
    displayName: string | null;
    did: string;
    email: string | null;
    emailConfirmed: boolean;
    passkeys: Array<{ added: string; lastUsed: string | null; current: boolean }>;
  };
  /** Options JSON from @simplewebauthn/server, passed straight to @simplewebauthn/browser. */
  options?: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
}

async function post(path: string, body: unknown): Promise<Answer> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  let answer: Answer;
  try {
    answer = (await res.json()) as Answer;
  } catch {
    answer = {};
  }
  if (!res.ok) throw new Error(answer.message ?? "Something went wrong. Try again.");
  return answer;
}

function say(message: string): void {
  const status = document.querySelector<HTMLElement>("[data-status]");
  if (status) status.textContent = message;
}

/** WebAuthn errors the person caused (cancelled, timed out) get a plain message. */
function explain(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "NotAllowedError" || err.name === "AbortError") {
      return "The passkey request was cancelled or timed out. Try again when you're ready.";
    }
    if (err.name === "InvalidStateError") return "This device already has a passkey for this Mosaic ID.";
    return err.message;
  }
  return "Something went wrong. Try again.";
}

function busy(form: HTMLFormElement, on: boolean): void {
  for (const button of form.querySelectorAll("button")) button.disabled = on;
  form.setAttribute("aria-busy", String(on));
}

/** After sign-up, or sign-in with an unconfirmed address: say so, then let the person continue. */
function remind(masked: string, redirect: string | undefined, signedUp: boolean, keepText = false): void {
  const section = document.getElementById("reminder");
  const text = section?.querySelector<HTMLElement>("[data-reminder-text]");
  const link = section?.querySelector<HTMLAnchorElement>("[data-continue]");
  if (!section || !text || !link) {
    if (redirect) window.location.assign(redirect);
    return;
  }
  if (!keepText) {
    text.textContent = signedUp
      ? `Your Mosaic ID is ready and works now. We sent a link to ${masked}; open it to confirm the address you'd use if you lose your passkey.`
      : `We still need you to confirm ${masked}. Open the link we sent, so you can get back in if you lose your passkey.`;
  }
  if (redirect) {
    link.href = redirect;
    link.textContent = "Continue to Mosaic River";
  } else {
    link.hidden = true;
  }
  for (const form of document.querySelectorAll("form")) form.hidden = true;
  say("");
  section.hidden = false;
  section.querySelector<HTMLElement>("h2")?.focus();
}

/** After sign-in with a Mosaic ID that has no recovery address: say so plainly, link to adding one. */
function noAddress(redirect: string | undefined): void {
  const section = document.getElementById("reminder");
  const heading = section?.querySelector<HTMLElement>("h2");
  const text = section?.querySelector<HTMLElement>("[data-reminder-text]");
  const link = section?.querySelector<HTMLAnchorElement>("[data-address-link]");
  if (!section || !heading || !text || !link) {
    if (redirect) window.location.assign(redirect);
    return;
  }
  heading.textContent = "Your Mosaic ID has no recovery address";
  text.textContent =
    "If you lose your passkey, there is no way back in. Add an email address you can confirm, so we can send you a link.";
  link.textContent = "Add a recovery address";
  remind("", redirect, false, true);
}

async function signIn(form: HTMLFormElement): Promise<void> {
  const request = form.dataset.request;
  const { options } = await post("/authorize/signin/options", { request });
  if (!options) throw new Error("Something went wrong. Try again.");
  say("Use your passkey…");
  const response = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
  const answer = await post("/authorize/signin/verify", { request, response });
  if (answer.noAddress) return noAddress(answer.redirect);
  if (answer.reminder) return remind(answer.reminder, answer.redirect, false);
  if (answer.redirect) window.location.assign(answer.redirect);
}

async function signUp(form: HTMLFormElement): Promise<void> {
  const request = form.dataset.request;
  const data = new FormData(form);
  const { options } = await post("/authorize/signup/options", {
    request,
    email: data.get("email"),
    display_name: data.get("display_name"),
  });
  if (!options) throw new Error("Something went wrong. Try again.");
  say("Create your passkey…");
  const response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
  const answer = await post("/authorize/signup/verify", { request, response });
  remind(answer.reminder ?? "your address", answer.redirect, true);
}

async function recover(form: HTMLFormElement): Promise<void> {
  const answer = await post("/recover/options", { token: form.dataset.token });
  if (!answer.options || !answer.request) throw new Error("Something went wrong. Try again.");
  say("Create your new passkey…");
  const response = await startRegistration({ optionsJSON: answer.options as PublicKeyCredentialCreationOptionsJSON });
  const result = await post("/recover/verify", { request: answer.request, response });
  if (result.passkeys && result.passkeys.others.length > 0 && result.request) {
    showPasskeys(form, result.request, result.passkeys, result.redirect);
    return;
  }
  if (result.redirect) {
    window.location.assign(result.redirect);
    return;
  }
  form.hidden = true;
  say("");
  const done = document.getElementById("recovered");
  if (done) {
    done.hidden = false;
    done.querySelector<HTMLElement>("h2")?.focus();
  }
}

/** After a recovery: how many passkeys the Mosaic ID has, each other one with a Remove button. */
function showPasskeys(
  form: HTMLFormElement,
  request: string,
  passkeys: NonNullable<Answer["passkeys"]>,
  redirect: string | undefined,
): void {
  const section = document.getElementById("passkeys");
  const count = section?.querySelector<HTMLElement>("[data-passkey-count]");
  const list = section?.querySelector<HTMLUListElement>("[data-passkey-list]");
  const link = section?.querySelector<HTMLAnchorElement>("[data-continue]");
  if (!section || !count || !list || !link) {
    if (redirect) window.location.assign(redirect);
    return;
  }
  let total = passkeys.total;
  const describe = () => {
    count.textContent =
      total === 1
        ? "Your Mosaic ID now has 1 passkey: the one you just made."
        : `Your Mosaic ID now has ${total} passkeys: the one you just made and ${total - 1} other${total === 2 ? "" : "s"}.`;
  };
  describe();
  list.replaceChildren();
  for (const other of passkeys.others) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `Passkey added ${other.added}, ${other.lastUsed ? `last used ${other.lastUsed}` : "never used"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove the passkey added ${other.added}`);
    remove.addEventListener("click", () => {
      remove.disabled = true;
      post("/recover/passkeys/remove", { request, passkey: other.id })
        .then(() => {
          item.remove();
          total -= 1;
          describe();
          say("Passkey removed.");
          count.focus();
        })
        .catch((err: unknown) => {
          remove.disabled = false;
          say(explain(err));
        });
    });
    item.append(label, remove);
    list.append(item);
  }
  if (redirect) {
    link.href = redirect;
    link.textContent = "Continue to Mosaic River";
  } else {
    link.textContent = "Done";
    link.href = "/";
  }
  form.hidden = true;
  say("");
  section.hidden = false;
  section.querySelector<HTMLElement>("h2")?.focus();
}

async function changeEmail(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const answer = await post("/account/email/options", { email: data.get("email") });
  if (!answer.options || !answer.request) throw new Error("Something went wrong. Try again.");
  say("Confirm with your passkey…");
  const response = await startAuthentication({ optionsJSON: answer.options as PublicKeyCredentialRequestOptionsJSON });
  const result = await post("/account/email/verify", { request: answer.request, response });
  say(result.message ?? "Done.");
}

async function showAccount(form: HTMLFormElement): Promise<void> {
  const answer = await post("/account/options", {});
  if (!answer.options || !answer.request) throw new Error("Something went wrong. Try again.");
  say("Confirm with your passkey…");
  const response = await startAuthentication({ optionsJSON: answer.options as PublicKeyCredentialRequestOptionsJSON });
  const { account } = await post("/account/verify", { request: answer.request, response });
  const section = document.getElementById("account-details");
  if (!account || !section) throw new Error("Something went wrong. Try again.");
  const field = <T extends HTMLElement>(name: string) => section.querySelector<T>(`[data-account-${name}]`);

  const name = field("name");
  if (name) name.textContent = account.displayName ? `Name: ${account.displayName}` : "No name set.";
  const did = field("did");
  if (did) did.textContent = account.did;

  // The address says plainly where things stand, and the link fits: add, confirm, or change.
  const email = field("email");
  const emailLink = field<HTMLAnchorElement>("email-link");
  if (email && emailLink) {
    if (!account.email) {
      email.textContent = "Your Mosaic ID has no recovery address. If you lose your passkey, there is no way back in.";
      emailLink.textContent = "Add a recovery address";
    } else if (!account.emailConfirmed) {
      email.textContent = `${account.email}, not confirmed yet. Open the link we sent to confirm it.`;
      emailLink.textContent = "Send the link again or use another address";
    } else {
      email.textContent = `${account.email}, confirmed.`;
      emailLink.textContent = "Change your address";
    }
  }

  const count = field("passkey-count");
  if (count) count.textContent = account.passkeys.length === 1 ? "1 passkey." : `${account.passkeys.length} passkeys.`;
  const list = field<HTMLUListElement>("passkeys");
  if (list) {
    list.replaceChildren(
      ...account.passkeys.map((p) => {
        const item = document.createElement("li");
        const used = p.lastUsed ? `last used ${p.lastUsed}` : "never used";
        item.textContent = `Passkey added ${p.added}, ${used}${p.current ? " (the one you just used)" : ""}`;
        return item;
      }),
    );
  }
  form.hidden = true;
  say("");
  section.hidden = false;
  section.querySelector<HTMLElement>("h2")?.focus();
}

const FLOWS: Record<string, (form: HTMLFormElement) => Promise<void>> = {
  signin: signIn,
  signup: signUp,
  recover,
  "change-email": changeEmail,
  account: showAccount,
};

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-passkey]")) {
  const flow = FLOWS[form.dataset.passkey ?? ""];
  if (!flow) continue;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    busy(form, true);
    say("");
    flow(form)
      .catch((err: unknown) => say(explain(err)))
      .finally(() => busy(form, false));
  });
}

document.documentElement.dataset.passkey = "ready";
