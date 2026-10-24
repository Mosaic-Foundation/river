import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processKey, type ProcessKey } from "../../../ui/src/lib/format";

// Civic mode wears the Civic Hub's default theme (DECISIONS.md, 2026-10-21). This reads civic.css
// itself and checks the text pairs the River puts on screen meet WCAG AA (4.5:1), so a later
// token change can't quietly drop below it. axe in the e2e tests checks the rendered pages.
const css = readFileSync(new URL("../../../ui/src/styles/themes/civic.css", import.meta.url), "utf8");

// The light tokens, then dark mode's (ui-revisions-9 item 2), which redefine some of them.
const DARK = '[data-theme="civic"][data-scheme="dark"]';
const darkAt = css.indexOf(DARK);

function tokens(text: string, base = new Map<string, string>()): Map<string, string> {
  const map = new Map(base);
  for (const m of text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const light = tokens(darkAt === -1 ? css : css.slice(0, darkAt));
const dark = tokens(css.slice(darkAt), light);
let declared = light;

/** A token's hex value, following var() references. */
function hex(name: string): string {
  let value = declared.get(name);
  for (let hops = 0; value?.startsWith("var("); hops++) {
    if (hops > 5) throw new Error(`${name}: var() loop`);
    value = declared.get(value.slice(4, -1).trim());
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a hex color: ${value}`);
  return value.toLowerCase();
}

function channels(color: string): number[] {
  const n = parseInt(color.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** color-mix(in srgb, color pct%, base), as the browser computes the process pills' tint. */
function mix(color: string, pct: number, base: string): string {
  const a = channels(color);
  const b = channels(base);
  return `#${a.map((v, i) => Math.round(v * pct + b[i]! * (1 - pct)).toString(16).padStart(2, "0")).join("")}`;
}

const PROCESS_KEYS: ProcessKey[] = [
  "vote",
  "proposal",
  "conversation",
  "project",
  "announcement",
  "meeting",
  "brief",
  "wordcloud",
];

describe("Civic theme (civic.css)", () => {
  it("has a dark block (ui-revisions-9 item 2)", () => {
    expect(darkAt).toBeGreaterThan(0);
    expect(css.slice(darkAt)).toMatch(/color-scheme:\s*dark/);
  });

  it("uses the Civic Hub's default theme values", () => {
    declared = light;
    expect(hex("--color-primary")).toBe("#2a4e84");
    expect(hex("--color-primary-hover")).toBe("#1f3a66");
    expect(hex("--color-accent")).toBe("#c37b51");
    expect(hex("--color-text")).toBe("#16243a");
    expect(hex("--color-text-muted")).toBe("#5e6e88");
    expect(hex("--color-border")).toBe("#c8cfdb");
    expect(hex("--color-page")).toBe("#f8f6f3");
    expect(hex("--color-surface")).toBe("#ffffff");
    expect(hex("--color-surface-alt")).toBe("#f4f1ea");
    expect(declared.get("--font-heading")).toMatch(/^"Libre Franklin"/);
    expect(declared.get("--font-body")).toMatch(/^"Inter"/);
    expect(`${declared.get("--font-heading")} ${declared.get("--font-body")}`).not.toMatch(/newsreader/i);
    expect(css).not.toMatch(/@import[^;]*newsreader/i);
  });

  for (const [scheme, tokensOf] of [["light", light], ["dark", dark]] as const) {
    it(`${scheme}: keeps body, heading, muted and link text at AA on every surface`, () => {
      declared = tokensOf;
      const surfaces = ["--color-page", "--color-surface", "--color-surface-alt"];
      for (const text of ["--color-text", "--color-heading", "--color-text-muted", "--color-link", "--color-danger"]) {
        for (const surface of surfaces) {
          expect(contrast(hex(text), hex(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${scheme}: keeps filled controls, chips and banners at AA`, () => {
      declared = tokensOf;
      const pairs: Array<[string, string]> = [
        ["--color-on-primary", "--color-primary"],
        ["--color-on-primary", "--color-primary-hover"],
        ["--color-primary", "--color-info-soft"], // Live label, active filters, Following badge
        ["--color-text", "--color-accent-soft"], // sample banner and label, quiet banner
        ["--color-text", "--color-warning-soft"], // deadline chip
        ["--color-text", "--color-surface-pressed"],
        ["--color-success", "--color-success-soft"], // Final result chip
        ["--color-danger", "--color-danger-soft"], // follow errors
      ];
      for (const [fg, bg] of pairs) {
        expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${scheme}: has a color for every process key, and each pill is AA on its tint`, () => {
      declared = tokensOf;
      const tint = Number.parseFloat(declared.get("--process-tint") ?? "") / 100;
      expect(tint).toBeGreaterThan(0);
      for (const key of PROCESS_KEYS) {
        const hue = hex(`--color-process-${key}`);
        const pill = mix(hue, tint, hex("--color-surface"));
        expect(contrast(hue, pill), `${key} pill`).toBeGreaterThanOrEqual(4.5);
      }
      // Every key processKey can return has a color (checked through the hub's process types).
      const returned = ["vote", "proposal", "polis_deliberation", "project", "announcement", "meeting_summary", "brief", "wordcloud"]
        .map((t) => processKey({ processType: `civic.${t}` }))
        .sort();
      expect(returned).toEqual([...PROCESS_KEYS].sort());
    });
  }
});
