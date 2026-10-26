// The identity host's emails (spec 4.6). Plain text only; links carry a single-use token.
import type { OutgoingEmail } from "./index.js";

/** The words the confirm email and the confirm page share (security review of 3a86e8f, item 5). */
export const CONFIRM_WARNING = {
  /** A Mosaic ID that never had a confirmed address (a sign-up, or one adding an address later). */
  signup:
    "Someone started a Mosaic ID with this address. If it wasn't you, don't confirm. Just ignore this email and the address will be released in 24 hours.",
  /** A Mosaic ID with a confirmed address, moving to this one. */
  change: "Someone asked to move their Mosaic ID to this address. If it wasn't you, don't confirm. Just ignore this email and nothing changes.",
} as const;

/** How the confirm email and page name the sign-up: the display name it gave, quoted, or none. */
export function nameLine(displayName: string | null | undefined): string {
  return displayName ? `The Mosaic ID gave the name “${displayName}”.` : "The Mosaic ID gave no name.";
}

export function verifyEmailMessage(
  to: string,
  link: string,
  who: { displayName: string | null | undefined; signup: boolean },
): OutgoingEmail {
  return {
    kind: "verify_email",
    to,
    subject: "Confirm your email for Mosaic ID",
    text: [
      who.signup ? CONFIRM_WARNING.signup : CONFIRM_WARNING.change,
      "",
      nameLine(who.displayName),
      "",
      "If it was you, open this link and press “Confirm my address”. The address is how you get back in if you lose your passkey.",
      "",
      `Confirm: ${link}`,
      "",
      "The link works once and expires in 24 hours.",
    ].join("\n"),
  };
}

/**
 * Sent instead of a confirm link when a sign-up, or a change of address, names an address another
 * Mosaic ID has confirmed.
 */
export function signupAttemptMessage(to: string): OutgoingEmail {
  return {
    kind: "signup_attempt",
    to,
    subject: "Someone tried to use your email for a Mosaic ID",
    text: [
      "Someone tried to use this address for another Mosaic ID. It already belongs to a Mosaic ID, so",
      "nothing about yours changed, and the other one can't use this address.",
      "",
      "If it was you, sign in with your passkey, or use “Lost your passkey?” on the sign-in page.",
      "If it wasn't, you can ignore this email.",
    ].join("\n"),
  };
}

export function recoverMessage(to: string, link: string): OutgoingEmail {
  return {
    kind: "recover",
    to,
    subject: "Add a new passkey to your Mosaic ID",
    text: [
      "Someone asked to add a new passkey to the Mosaic ID that uses this address.",
      "",
      `If it was you, open this link on the device you want to use: ${link}`,
      "",
      "The link works once and expires in 15 minutes. If it wasn't you, ignore this email; nothing changes.",
    ].join("\n"),
  };
}

export function recoveryNoticeMessage(to: string): OutgoingEmail {
  return {
    kind: "recovery_notice",
    to,
    subject: "A new passkey was added to your Mosaic ID",
    text: [
      "A new passkey was just added to your Mosaic ID through an emailed recovery link.",
      "",
      "If that was you, there is nothing to do. If it wasn't, someone can read this mailbox: secure it,",
      "then contact Mosaic.",
    ].join("\n"),
  };
}

export function emailChangeNoticeMessage(to: string, maskedNew: string): OutgoingEmail {
  return {
    kind: "email_change_notice",
    to,
    subject: "Your Mosaic ID email is changing",
    text: [
      `Someone signed in with your passkey and asked to change your Mosaic ID's email to ${maskedNew}.`,
      "The change happens once the new address is confirmed.",
      "",
      "If that wasn't you, sign in and change it back, and check who can use your passkeys.",
    ].join("\n"),
  };
}
