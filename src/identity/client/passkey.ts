// Browser script for the identity host's passkey pages, bundled by `npm run build:identity-client`
// into identity/public/passkey.js (spec Appendix A). The pages carry no inline script (Appendix B
// CSP); this reads each form's data-* attributes, runs the WebAuthn ceremony with
// @simplewebauthn/browser, and talks only to its own origin (connect-src 'self').
//
// Forms: #signin and #signup (authorize page), #recover (recovery link page), #change-email.
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
  done?: boolean;
  request?: string;
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
function remind(masked: string, redirect: string | undefined, signedUp: boolean): void {
  const section = document.getElementById("reminder");
  const text = section?.querySelector<HTMLElement>("[data-reminder-text]");
  const link = section?.querySelector<HTMLAnchorElement>("[data-continue]");
  if (!section || !text || !link) {
    if (redirect) window.location.assign(redirect);
    return;
  }
  text.textContent = signedUp
    ? `Your Mosaic ID is ready and works now. We sent a link to ${masked}; open it to confirm the address you'd use if you lose your passkey.`
    : `We still need you to confirm ${masked}. Open the link we sent, so you can get back in if you lose your passkey.`;
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

async function signIn(form: HTMLFormElement): Promise<void> {
  const request = form.dataset.request;
  const { options } = await post("/authorize/signin/options", { request });
  if (!options) throw new Error("Something went wrong. Try again.");
  say("Use your passkey…");
  const response = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
  const answer = await post("/authorize/signin/verify", { request, response });
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

async function changeEmail(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const answer = await post("/account/email/options", { email: data.get("email") });
  if (!answer.options || !answer.request) throw new Error("Something went wrong. Try again.");
  say("Confirm with your passkey…");
  const response = await startAuthentication({ optionsJSON: answer.options as PublicKeyCredentialRequestOptionsJSON });
  const result = await post("/account/email/verify", { request: answer.request, response });
  say(result.message ?? "Done.");
}

const FLOWS: Record<string, (form: HTMLFormElement) => Promise<void>> = {
  signin: signIn,
  signup: signUp,
  recover,
  "change-email": changeEmail,
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
