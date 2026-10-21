// The sanitizer (spec Appendix B) and the sanitizer half of acceptance check 22.
import { describe, expect, it } from "vitest";
import { LINK_REL, sanitize, toPlainText } from "../../src/shared/sanitize/index.js";

describe("sanitize", () => {
  it("check 22: drops <script>, onerror and javascript: links; keeps Mastodon's invisible and ellipsis spans", () => {
    const post =
      '<p>Hello<script>alert(1)</script> <img src="x" onerror="alert(2)">' +
      '<a href="javascript:alert(3)">click</a> ' +
      '<a href="https://w3c.social/@w3c" class="mention">' +
      '<span class="invisible">https://</span><span class="ellipsis">w3c.social/@w3c/1234</span>' +
      '<span class="invisible">567</span></a></p>';
    const out = sanitize(post);
    expect(out).not.toMatch(/script|alert|onerror|javascript:|<img/i);
    expect(out).toContain('<span class="invisible">https://</span>');
    expect(out).toContain('<span class="ellipsis">w3c.social/@w3c/1234</span>');
    expect(out).toContain(`<a href="https://w3c.social/@w3c" rel="${LINK_REL}">`);
    expect(out).toContain(`<a rel="${LINK_REL}">click</a>`);
  });

  it("keeps exactly the allowlisted tags", () => {
    const html =
      "<p><em>a</em><strong>b</strong><code>c</code><br></p><pre>d</pre><blockquote>e</blockquote>" +
      "<ul><li>f</li></ul><ol><li>g</li></ol><h1>h</h1><div>i</div><table><tr><td>j</td></tr></table>" +
      "<iframe src=\"https://evil.example\"></iframe><style>p{}</style><form><input></form>";
    expect(sanitize(html)).toBe(
      "<p><em>a</em><strong>b</strong><code>c</code><br /></p><pre>d</pre><blockquote>e</blockquote>" +
        "<ul><li>f</li></ul><ol><li>g</li></ol>hij",
    );
  });

  it("keeps only https hrefs, absolute, and forces rel", () => {
    for (const href of ["http://example.org", "/relative", "//proto-relative.example", "data:text/html,x", "mailto:a@b.c", " JaVaScRiPt:alert(1)"]) {
      expect(sanitize(`<a href="${href}" rel="opener" target="_top">x</a>`), href).toBe(`<a rel="${LINK_REL}">x</a>`);
    }
    expect(sanitize('<a href="https://ok.example/a?b=1&amp;c=2" rel="opener">x</a>')).toBe(
      `<a href="https://ok.example/a?b=1&amp;c=2" rel="${LINK_REL}">x</a>`,
    );
  });

  it("drops every other attribute and class value", () => {
    expect(sanitize('<p class="invisible h-card" style="color:red" id="x" data-a="1">t</p>')).toBe(
      '<p class="invisible">t</p>',
    );
    expect(sanitize('<span class="mention">t</span>')).toBe("<span>t</span>");
  });

  it("returns an empty string for nothing", () => {
    expect(sanitize(null)).toBe("");
    expect(sanitize(undefined)).toBe("");
    expect(sanitize("")).toBe("");
  });
});

describe("toPlainText", () => {
  it("removes every tag and decodes common entities", () => {
    expect(toPlainText("<p>Fish &amp; <em>chips</em></p>\n<p>tonight&nbsp;at 7</p><script>x()</script>")).toBe(
      "Fish & chips tonight at 7",
    );
    expect(toPlainText(null)).toBe("");
  });
});
