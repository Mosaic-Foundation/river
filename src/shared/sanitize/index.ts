// The one way HTML from outside sources reaches a page (CLAUDE.md constraint 8, spec Appendix B).
// Adapters sanitize when they store content (items.content_html is sanitized at rest); the UI
// renders only that column as HTML.
//
// Allowlist (Appendix B): p, br, a, span, ul, ol, li, blockquote, code, pre, em, strong. Links keep
// an https href only, and rel is always "nofollow noopener noreferrer". class survives only as
// `invisible` or `ellipsis` (Mastodon's link-shortening spans). Everything else is dropped: script
// and style with their contents, other tags with their text kept. Changing the allowlist is a
// needs-adam change.
import sanitizeHtml from "sanitize-html";

export const ALLOWED_TAGS = [
  "p", "br", "a", "span", "ul", "ol", "li", "blockquote", "code", "pre", "em", "strong",
] as const;

export const ALLOWED_CLASSES = ["invisible", "ellipsis"] as const;

export const LINK_REL = "nofollow noopener noreferrer";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: { a: ["href", "rel"], "*": ["class"] },
  allowedClasses: { "*": [...ALLOWED_CLASSES] },
  allowedSchemes: ["https"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Keep only an absolute https href (a relative one would resolve against the River's own
    // origin), and always set rel.
    a: (_tagName, attribs) => {
      const href = (attribs.href ?? "").trim();
      const kept: sanitizeHtml.Attributes = /^https:\/\//i.test(href) ? { href } : {};
      kept.rel = LINK_REL;
      return { tagName: "a", attribs: kept };
    },
  },
};

/** Sanitizes untrusted HTML to the Appendix B allowlist. */
export function sanitize(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, OPTIONS);
}

/** Plain text from untrusted HTML (titles, summaries, search): every tag removed, entities kept as text. */
export function toPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
