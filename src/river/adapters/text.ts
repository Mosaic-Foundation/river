// Text helpers the adapters share. Nothing here decides what HTML is allowed: every result still
// goes through sanitize() (src/shared/sanitize/, CLAUDE.md constraint 8) before it is stored.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for use as HTML text. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * Plain text (or Markdown, which is shown as typed) as HTML paragraphs: blank lines split
 * paragraphs, single line breaks become <br>. Everything is escaped, so no markup in the text
 * survives as markup.
 */
export function plainTextAsHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter((para) => para !== "")
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
