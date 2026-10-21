// The identity host's emails (spec 4.6). Plain text only; links carry a single-use token.
import type { OutgoingEmail } from "./index.js";

export function verifyEmailMessage(to: string, link: string): OutgoingEmail {
  return {
    kind: "verify_email",
    to,
    subject: "Confirm your email for Mosaic ID",
    text: [
      "Please confirm this address for your Mosaic ID. It is how you get back in if you lose your passkey.",
      "",
      `Confirm: ${link}`,
      "",
      "The link works once and expires in 24 hours. If you didn't ask for this, you can ignore it.",
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
