// A small, lenient XML reader for feeds (M12, ADR-007). Feeds in the wild are often not
// well-formed (a stray "&", an unclosed tag), and browsers and podcast apps read them anyway, so
// this reader keeps going where a strict parser would stop. What it never does:
//
// - expand entity declarations: a document whose DOCTYPE declares entities is refused outright
//   (no "billion laughs", no external entities); only the five XML entities and numeric
//   references are decoded;
// - fetch anything (DTDs, schemas, stylesheets);
// - grow past MAX_DEPTH nesting levels or MAX_ELEMENTS elements (the fetch guard already caps the
//   body at 2 MB), or read more than MAX_NAMESPACES namespace declarations (later ones are ignored,
//   so their prefixes read as written);
// - take more than linear time on hostile input: a "<" with no ">" after it ends the scan (the rest
//   of the document is text), and after one tag whose quotes never close, tags end at the next ">"
//   so no later tag rescans to the end of the document.
//
// Names are canonical: elements in the namespaces feeds use get fixed prefixes whatever prefix
// the document chose (`itunes:duration`, `content:encoded`, `media:thumbnail`, `atom:entry`,
// `dc:creator`), so a feed that writes `<podcast:...>` or `<a:entry>` reads the same.

export interface XmlElement {
  /** Canonical name (see KNOWN_NAMESPACES); unknown prefixes are kept as written. */
  name: string;
  /** The name without its prefix. */
  local: string;
  /** Attributes as written (decoded values). */
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

export const MAX_DEPTH = 100;
export const MAX_ELEMENTS = 50_000;
export const MAX_NAMESPACES = 64;

/** Namespace URIs (scheme and trailing slash ignored) and the prefix each always reads as. */
const KNOWN_NAMESPACES: Readonly<Record<string, string>> = {
  "www.itunes.com/dtds/podcast-1.0.dtd": "itunes",
  "purl.org/rss/1.0/modules/content": "content",
  "search.yahoo.com/mrss": "media",
  "www.w3.org/2005/Atom": "atom",
  "purl.org/dc/elements/1.1": "dc",
  "www.w3.org/1999/02/22-rdf-syntax-ns#": "rdf",
  "www.w3.org/1999/xhtml": "xhtml",
  "podcastindex.org/namespace/1.0": "podcast",
  // RSS 1.0's elements read like RSS 2.0's (channel, item, title, link...).
  "purl.org/rss/1.0": "",
};

function knownPrefix(uri: string): string | undefined {
  return KNOWN_NAMESPACES[uri.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Decodes the five XML entities and numeric references; anything else is left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{0,31});/g, (match, ref: string) => {
    if (ref.startsWith("#")) {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : "�";
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTRIBUTE)) {
    const name = m[1];
    if (!name || Object.prototype.hasOwnProperty.call(attrs, name)) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Index of the ">" that ends the tag starting at `from`, outside quotes; -1 if none. */
function tagEnd(text: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

/** Index just past a declaration (`<!DOCTYPE ... [ ... ]>`) starting at `from`. */
function declarationEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/** prefix -> namespace URI in scope ("" is the default namespace). */
type Namespaces = ReadonlyMap<string, string>;

interface Frame {
  el: XmlElement;
  /** The tag name as written, to match its end tag. */
  rawName: string;
  /** Shared with the parent frame unless this element declares a namespace. */
  ns: Namespaces;
}

/** A tag name at the start of a tag (sticky: set lastIndex to the character after "<"). */
const TAG_NAME = /[A-Za-z_][\w.:-]*/y;

function canonicalName(rawName: string, ns: Namespaces): { name: string; local: string } {
  const colon = rawName.indexOf(":");
  const prefix = colon === -1 ? "" : rawName.slice(0, colon);
  const local = colon === -1 ? rawName : rawName.slice(colon + 1);
  const uri = ns.get(prefix);
  const known = uri === undefined ? undefined : knownPrefix(uri);
  if (known !== undefined) return { name: known ? `${known}:${local}` : local, local };
  return { name: prefix ? `${prefix}:${local}` : local, local };
}

/**
 * Parses a document and returns its root element. Throws XmlError for a document with no
 * element, an entity declaration, or past the size limits.
 */
export function parseXml(text: string): XmlElement {
  const doc: XmlElement = { name: "#document", local: "#document", attrs: {}, children: [] };
  const stack: Frame[] = [{ el: doc, rawName: "", ns: new Map() }];
  let elements = 0;
  let namespaces = 0;
  // Whether a ">" inside quotes is skipped when finding where a tag ends (see tagEnd).
  let quoteAware = true;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const top = (): Frame => stack[stack.length - 1] as Frame;
  const addText = (value: string): void => {
    if (value === "") return;
    const children = top().el.children;
    const last = children[children.length - 1];
    if (typeof last === "string") children[children.length - 1] = last + value;
    else children.push(value);
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      addText(decodeEntities(text.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(text.slice(i, lt)));

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      addText(text.slice(lt + 9, end === -1 ? text.length : end));
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      const end = declarationEnd(text, lt + 2);
      const declaration = text.slice(lt, end === -1 ? text.length : end);
      if (/<!ENTITY/i.test(declaration)) throw new XmlError("Entity declarations are not read");
      i = end === -1 ? text.length : end;
      continue;
    }
    if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      const rawName = text.slice(lt + 2, end === -1 ? text.length : end).trim();
      // Close the nearest open element with this name; an end tag nothing opened is ignored.
      for (let s = stack.length - 1; s > 0; s--) {
        if ((stack[s] as Frame).rawName === rawName) {
          stack.length = s;
          break;
        }
      }
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    TAG_NAME.lastIndex = lt + 1;
    const nameMatch = TAG_NAME.exec(text);
    if (!nameMatch) {
      // A stray "<" in text (sloppy feeds): keep it as text.
      addText("<");
      i = lt + 1;
      continue;
    }
    const end = quoteAware ? tagEnd(text, lt + 1) : text.indexOf(">", lt + 1);
    if (end === -1) {
      if (!quoteAware || text.indexOf(">", lt + 1) === -1) {
        // No ">" anywhere after this: the rest is text, and no later "<" can start a tag either.
        addText(decodeEntities(text.slice(lt)));
        break;
      }
      // A quote in this tag never closes. Keep the "<" as text, and from here on end tags at the
      // next ">": scanning quotes again from every later "<" is what made this quadratic.
      quoteAware = false;
      addText("<");
      i = lt + 1;
      continue;
    }
    const rawName = nameMatch[0];
    let inner = text.slice(lt + 1 + rawName.length, end);
    const selfClosing = inner.trimEnd().endsWith("/");
    if (selfClosing) inner = inner.trimEnd().slice(0, -1);
    const attrs = parseAttributes(inner);

    let ns = top().ns;
    for (const [name, value] of Object.entries(attrs)) {
      if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
      if (++namespaces > MAX_NAMESPACES) break;
      if (ns === top().ns) ns = new Map(ns);
      (ns as Map<string, string>).set(name === "xmlns" ? "" : name.slice(6), value);
    }
    elements++;
    if (elements > MAX_ELEMENTS) throw new XmlError("Too many elements");
    const el: XmlElement = { ...canonicalName(rawName, ns), attrs, children: [] };
    top().el.children.push(el);
    if (!selfClosing) {
      if (stack.length > MAX_DEPTH) throw new XmlError("Nested too deeply");
      stack.push({ el, rawName, ns });
    }
    i = end + 1;
  }

  const root = doc.children.find((c): c is XmlElement => typeof c !== "string");
  if (!root) throw new XmlError("No element");
  return root;
}

// --- Reading helpers ---

export function elements(el: XmlElement | undefined): XmlElement[] {
  return el ? el.children.filter((c): c is XmlElement => typeof c !== "string") : [];
}

/** The first child element with this canonical name. */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return elements(el).find((c) => c.name === name);
}

/** Every child element with this canonical name. */
export function childrenNamed(el: XmlElement | undefined, name: string): XmlElement[] {
  return elements(el).filter((c) => c.name === name);
}

/** Every descendant element with this canonical name, in document order. */
export function descendants(el: XmlElement | undefined, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const c of elements(el)) {
    if (c.name === name) found.push(c);
    found.push(...descendants(c, name));
  }
  return found;
}

/** All the text inside an element (nested elements' text included), or undefined when empty. */
export function textOf(el: XmlElement | undefined): string | undefined {
  if (!el) return undefined;
  const parts: string[] = [];
  const walk = (node: XmlElement) => {
    for (const c of node.children) {
      if (typeof c === "string") parts.push(c);
      else walk(c);
    }
  };
  walk(el);
  const text = parts.join("").trim();
  return text === "" ? undefined : text;
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c);

/**
 * An element's children written back as markup, with local names (Atom's `type="xhtml"` content).
 * The result is untrusted HTML: it still goes through sanitize().
 */
export function innerMarkup(el: XmlElement | undefined): string {
  if (!el) return "";
  return el.children
    .map((c) => {
      if (typeof c === "string") return escape(c);
      const attrs = Object.entries(c.attrs)
        .filter(([name]) => name !== "xmlns" && !name.startsWith("xmlns:"))
        .map(([name, value]) => ` ${name}="${escape(value)}"`)
        .join("");
      return `<${c.local}${attrs}>${innerMarkup(c)}</${c.local}>`;
    })
    .join("");
}
