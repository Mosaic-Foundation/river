import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Mosaic theme's light and dark tokens (ui-revisions-9 item 2): reads mosaic.css itself and
// checks the text pairs the River draws meet WCAG AA (4.5:1), as civicTheme.test.ts does for
// Civic, so a later token change can't drop below it. axe in the e2e tests checks rendered pages.
const css = readFileSync(new URL("../../../ui/src/styles/themes/mosaic.css", import.meta.url), "utf8");

const DARK = ':root:not([data-theme="civic"])[data-scheme="dark"]';
const darkAt = css.indexOf(DARK);

function tokens(text: string, base = new Map<string, string>()): Map<string, string> {
  const map = new Map(base);
  for (const m of text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  return map;
}

const light = tokens(css.slice(0, darkAt));
const dark = tokens(css.slice(darkAt), light);

function hex(map: Map<string, string>, name: string): string {
  let value = map.get(name);
  for (let hops = 0; value?.startsWith("var("); hops++) {
    if (hops > 5) throw new Error(`${name}: var() loop`);
    value = map.get(value.slice(4, -1).trim());
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a hex color: ${value}`);
  return value.toLowerCase();
}

function luminance(color: string): number {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("Mosaic theme (mosaic.css)", () => {
  it("has a dark block that redefines the surfaces and text", () => {
    expect(darkAt).toBeGreaterThan(0);
    expect(css.slice(darkAt)).toMatch(/color-scheme:\s*dark/);
    expect(hex(dark, "--color-surface")).not.toBe(hex(light, "--color-surface"));
    // Dark means a dark surface and light text.
    expect(luminance(hex(dark, "--color-surface"))).toBeLessThan(0.05);
    expect(luminance(hex(dark, "--color-text"))).toBeGreaterThan(0.6);
  });

  it("dark: keeps body, heading, muted and link text at AA on every surface", () => {
    for (const text of ["--color-text", "--color-heading", "--color-text-muted", "--color-link", "--color-danger"]) {
      for (const surface of ["--color-bg", "--color-surface", "--color-surface-alt"]) {
        expect(contrast(hex(dark, text), hex(dark, surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("dark: keeps filled controls, chips and banners at AA", () => {
    const pairs: Array<[string, string]> = [
      ["--color-on-primary", "--color-primary"],
      ["--color-on-primary", "--color-primary-hover"],
      ["--color-primary", "--color-info-soft"],
      ["--color-text", "--color-accent-soft"],
      ["--color-text", "--color-info-soft"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(hex(dark, fg), hex(dark, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("light: body and heading text stay at AA on the surfaces", () => {
    for (const text of ["--color-text", "--color-heading", "--color-text-muted"]) {
      for (const surface of ["--color-surface", "--color-surface-alt"]) {
        expect(contrast(hex(light, text), hex(light, surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
