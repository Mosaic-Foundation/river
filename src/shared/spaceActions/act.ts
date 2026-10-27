// The `act` schema (space-actions-1 3.4), exactly: the fields each verb carries and nothing else,
// so a signature never covers something a space ignored. Mosaic ID checks an act with this before
// it signs (5.2), and a space's verifier checks it again (4 step 8). Whether a target accepts the
// act (its options, its `max_length`, one choice unless `multiple`) is the space's own check
// (4 step 11), not this one.
import {
  ACT_VERBS,
  MAX_COMMENT_LENGTH,
  MAX_POLL_CHOICES,
  RSVP_ANSWERS,
  VERBS,
  type Act,
  type ActVerb,
} from "./types.js";

/** The fields each verb's act carries; `lang` is the only optional one (3.4). */
const FIELDS: Record<ActVerb, { required: readonly string[]; optional: readonly string[] }> = {
  comment: { required: ["verb", "target", "ref", "content"], optional: ["lang"] },
  support: { required: ["verb", "target", "ref"], optional: [] },
  rsvp: { required: ["verb", "target", "ref", "answer"], optional: [] },
  poll_answer: { required: ["verb", "target", "ref", "choices"], optional: [] },
  withdraw: { required: ["verb", "target", "ref", "withdraws"], optional: [] },
};

const MAX_IRI_LENGTH = 2048;
/** A UUID in its canonical lowercase form, so one `ref` has exactly one spelling. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A BCP 47 tag's shape (language, then subtags), at most 35 characters. */
const LANG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
/** A poll choice id: what 2.2's `choices[].id` may be. */
const CHOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Something that reads as an HTML tag, comment or declaration (`<p`, `</`, `<!`, `<?`). */
const TAG_LIKE = /<[A-Za-z/!?]/;
/** Control characters other than tab, line feed and carriage return. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type ActCheck = { ok: true; act: Act } | { ok: false; reason: string };

function fail(reason: string): ActCheck {
  return { ok: false, reason };
}

/** An absolute https IRI with no credentials and no fragment, at most 2,048 characters. */
export function isHttpsIri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IRI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && !value.includes("#");
}

/** Length in characters (code points), as `max_length` counts them. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** Plain text a comment may carry: 1 to 5,000 characters, not blank, no HTML, no control characters. */
function commentContentProblem(content: unknown): string | undefined {
  if (typeof content !== "string") return "content is not text";
  if (content.trim() === "") return "content is empty";
  if (characterCount(content) > MAX_COMMENT_LENGTH) return "content is over 5,000 characters";
  if (TAG_LIKE.test(content)) return "content looks like HTML";
  if (CONTROL.test(content)) return "content has control characters";
  return undefined;
}

/** Checks a value against 3.4; on success returns it typed (the same object, unchanged). */
export function checkAct(value: unknown): ActCheck {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("act is not an object");
  const act = value as Record<string, unknown>;
  const verb = act.verb;
  if (typeof verb !== "string" || !(ACT_VERBS as readonly string[]).includes(verb)) return fail("unknown verb");
  const fields = FIELDS[verb as ActVerb];
  for (const key of Object.keys(act)) {
    if (!fields.required.includes(key) && !fields.optional.includes(key)) return fail(`unknown field ${key}`);
  }
  for (const key of fields.required) {
    if (!Object.hasOwn(act, key)) return fail(`missing ${key}`);
  }
  if (!isHttpsIri(act.target)) return fail("target is not an https IRI");
  if (typeof act.ref !== "string" || !UUID.test(act.ref)) return fail("ref is not a lowercase UUID");

  switch (verb as ActVerb) {
    case "comment": {
      const problem = commentContentProblem(act.content);
      if (problem) return fail(problem);
      if (Object.hasOwn(act, "lang") && (typeof act.lang !== "string" || act.lang.length > 35 || !LANG.test(act.lang))) {
        return fail("lang is not a BCP 47 tag");
      }
      break;
    }
    case "support":
      break;
    case "rsvp":
      if (typeof act.answer !== "string" || !(RSVP_ANSWERS as readonly string[]).includes(act.answer)) {
        return fail("answer is not yes, no or maybe");
      }
      break;
    case "poll_answer": {
      const choices = act.choices;
      if (!Array.isArray(choices) || choices.length === 0 || choices.length > MAX_POLL_CHOICES) {
        return fail("choices is not a list of 1 to 20 ids");
      }
      if (!choices.every((id) => typeof id === "string" && CHOICE_ID.test(id))) return fail("a choice id is malformed");
      if (new Set(choices).size !== choices.length) return fail("a choice is repeated");
      break;
    }
    case "withdraw":
      if (typeof act.withdraws !== "string" || !(VERBS as readonly string[]).includes(act.withdraws)) {
        return fail("withdraws is not a verb");
      }
      break;
  }
  return { ok: true, act: act as unknown as Act };
}
