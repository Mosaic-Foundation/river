// The identity host's server-rendered pages (spec Appendix A): authorize, sign up (on the
// authorize page), recover, verify email and change email. Semantic markup, a label on every
// input, keyboard-reachable controls, no inline script or style (Appendix B CSP). Every value that
// reaches the markup goes through esc(). The passkey ceremonies run in /passkey.js, which reads
// its inputs from data-* attributes.
import { CONFIRM_WARNING, nameLine } from "./email/messages.js";

export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface PageOptions {
  /** Load /passkey.js (pages that run a passkey ceremony). */
  passkey?: boolean;
}

export function page(title: string, body: string, options: PageOptions = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<title>${esc(title)} · Mosaic ID</title>
<link rel="stylesheet" href="/identity.css">
${options.passkey ? '<script type="module" src="/passkey.js"></script>\n' : ""}</head>
<body>
<header class="site"><p class="brand"><a href="/">Mosaic ID</a></p></header>
<main>
${body}
</main>
</body>
</html>
`;
}

const STATUS = '<p class="status" role="status" aria-live="polite" data-status></p>';
const NOSCRIPT = "<noscript><p>Passkeys need JavaScript. Turn it on for this page, then reload.</p></noscript>";

export function homePage(): string {
  return page(
    "Mosaic ID",
    `<h1>Mosaic ID</h1>
<p>Mosaic ID signs you in to Mosaic River with a passkey. Your River sees your DID, never your email address.</p>
<ul>
<li><a href="/recover">Lost your passkey?</a></li>
<li><a href="/account/email">Change your email address</a></li>
</ul>`,
  );
}

export function authorizePage(requestId: string, clientName: string): string {
  const id = esc(requestId);
  return page(
    `Sign in to ${clientName}`,
    `<h1>Sign in to ${esc(clientName)}</h1>
<p>Mosaic ID keeps your passkey and your DID. ${esc(clientName)} sees your DID, never your email address.</p>
${NOSCRIPT}
<section aria-labelledby="signin-heading">
<h2 id="signin-heading">Have a Mosaic ID?</h2>
<form id="signin" data-passkey="signin" data-request="${id}">
<button type="submit">Sign in with your passkey</button>
</form>
<p><a href="/recover?request=${id}">Lost your passkey?</a></p>
</section>
<section aria-labelledby="signup-heading">
<h2 id="signup-heading">New here? Create a Mosaic ID</h2>
<form id="signup" data-passkey="signup" data-request="${id}" novalidate>
<p><label for="signup-email">Email address</label>
<input id="signup-email" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="signup-email-help"></p>
<p id="signup-email-help" class="help">Only for getting back in if you lose your passkey. We send a link to confirm it.</p>
<p><label for="signup-name">Your name <span class="optional">(optional)</span></label>
<input id="signup-name" name="display_name" type="text" autocomplete="name" maxlength="64"></p>
<button type="submit">Create a passkey</button>
</form>
</section>
${STATUS}
<section id="reminder" class="reminder" hidden aria-labelledby="reminder-heading">
<h2 id="reminder-heading" tabindex="-1">Please confirm your email</h2>
<p data-reminder-text></p>
<p><a data-continue href="/">Continue</a></p>
<p><a data-address-link href="/account/email">Send the link again or use another address</a></p>
</section>`,
    { passkey: true },
  );
}

export function errorPage(title: string, message: string): string {
  return page(title, `<h1>${esc(title)}</h1>\n<p>${esc(message)}</p>`);
}

export function recoverPage(requestId: string | undefined, notice?: string): string {
  const hidden = requestId ? `<input type="hidden" name="request" value="${esc(requestId)}">` : "";
  return page(
    "Lost your passkey?",
    `<h1>Lost your passkey?</h1>
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ""}
<p>Enter the email address on your Mosaic ID. If it is confirmed, we email you a link that adds a new passkey. The link works once, for 15 minutes.</p>
<form method="post" action="/recover">
${hidden}
<p><label for="recover-email">Email address</label>
<input id="recover-email" name="email" type="email" autocomplete="email" required maxlength="254"></p>
<button type="submit">Send me a link</button>
</form>`,
  );
}

export const RECOVER_SENT = "If that address has an account, we sent a link.";

export function recoverLinkPage(token: string): string {
  return page(
    "Add a new passkey",
    `<h1>Add a new passkey</h1>
<p>Create a passkey on this device. It joins your Mosaic ID; your other passkeys keep working.</p>
${NOSCRIPT}
<form id="recover" data-passkey="recover" data-token="${esc(token)}">
<button type="submit">Create a new passkey</button>
</form>
${STATUS}
<section id="passkeys" hidden aria-labelledby="passkeys-heading">
<h2 id="passkeys-heading" tabindex="-1">Your new passkey is ready</h2>
<p data-passkey-count tabindex="-1"></p>
<p>If you don't recognise one of them, remove it. Whoever holds it can sign in as you.</p>
<ul data-passkey-list></ul>
<p><a data-continue href="/">Continue</a></p>
</section>
<section id="recovered" hidden aria-labelledby="recovered-heading">
<h2 id="recovered-heading" tabindex="-1">Your new passkey is ready</h2>
<p>Go back to Mosaic River and sign in with it.</p>
</section>`,
    { passkey: true },
  );
}

export const LINK_GONE = "This link has expired or was already used.";

export function linkGonePage(again: { href: string; label: string }): string {
  return page(
    "Link expired",
    `<h1>This link doesn't work any more</h1>
<p>${esc(LINK_GONE)}</p>
<p><a href="${esc(again.href)}">${esc(again.label)}</a></p>`,
  );
}

export function verifyPage(token: string, who: { displayName: string | null; signup: boolean }): string {
  return page(
    "Confirm your email",
    `<h1>Confirm your email</h1>
<p class="notice">${esc(who.signup ? CONFIRM_WARNING.signup : CONFIRM_WARNING.change)}</p>
<p>${esc(nameLine(who.displayName))}</p>
<p>If it was you, press the button to confirm. The address is how you get back in if you lose your passkey.</p>
<form method="post" action="/verify">
<input type="hidden" name="token" value="${esc(token)}">
<button type="submit">Confirm my address</button>
</form>`,
  );
}

export function verifiedPage(): string {
  return page("Email confirmed", "<h1>Your address is confirmed</h1>\n<p>If you ever lose your passkey, we can send a link there.</p>");
}

export function changeEmailPage(): string {
  return page(
    "Change your email address",
    `<h1>Change your email address</h1>
<p>Enter the new address, then confirm with your passkey. We send a link to the new address; it becomes your recovery address once you open it. Your current address gets a notice.</p>
<p>No recovery address on your Mosaic ID? Add one here the same way.</p>
${NOSCRIPT}
<form id="change-email" data-passkey="change-email" novalidate>
<p><label for="new-email">New email address</label>
<input id="new-email" name="email" type="email" autocomplete="email" required maxlength="254"></p>
<button type="submit">Confirm with your passkey</button>
</form>
${STATUS}`,
    { passkey: true },
  );
}

/** Uses only the theme-free basics; the identity host has no theme tokens of its own yet. */
export const IDENTITY_CSS = `:root {
  --id-bg: #fbfaf7; --id-fg: #1f2328; --id-muted: #57606a; --id-accent: #2f6fa8; --id-on-accent: #ffffff; --id-border: #d0d7de;
  --id-space: 1rem; --id-radius: 0.5rem; --id-font: system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --id-bg: #161b22; --id-fg: #e6edf3; --id-muted: #9da7b3; --id-accent: #6ea8dc; --id-on-accent: #0d1117; --id-border: #30363d; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--id-bg); color: var(--id-fg); font: 1rem/1.5 var(--id-font); }
header.site, main { max-width: 36rem; margin: 0 auto; padding: 0 var(--id-space); }
header.site .brand { font-weight: 700; }
header.site a { color: inherit; text-decoration: none; }
a { color: var(--id-accent); }
section { border-top: 1px solid var(--id-border); margin-top: calc(var(--id-space) * 1.5); }
label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
input { width: 100%; padding: 0.5rem; font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--id-border); border-radius: var(--id-radius); }
button { font: inherit; padding: 0.5rem 1rem; border-radius: var(--id-radius); border: 0;
  background: var(--id-accent); color: var(--id-on-accent); cursor: pointer; }
:focus-visible { outline: 3px solid var(--id-accent); outline-offset: 2px; }
.help, .optional { color: var(--id-muted); font-weight: 400; }
.status:empty { display: none; }
.status, .notice { padding: 0.5rem; border-left: 4px solid var(--id-accent); }
ul[data-passkey-list] { list-style: none; padding: 0; }
ul[data-passkey-list] li { display: flex; gap: var(--id-space); align-items: center; justify-content: space-between;
  padding: 0.5rem 0; border-bottom: 1px solid var(--id-border); }
`;
