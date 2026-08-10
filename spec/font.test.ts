import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The text field renders nothing at all unless a font is configured, and it
// fails *silently*: troika 0.52.5 defaults both `Text.font` and
// `CONFIG.defaultFontURL` to null, hands the worker an empty font list, and
// falls back to fetching glyphs from cdn.jsdelivr.net at runtime. Every mesh
// then syncs "successfully" with no geometry, so the whole concept renders as
// an empty blue void — on exactly those networks that can't reach jsdelivr,
// and nowhere else. It shipped once looking perfect to the person who built it.
//
// This asserts against the source text rather than importing the module,
// because importing scene.ts would construct WebGL and a worker, neither of
// which exists under vitest. It is a coarse sensor, but it fails the moment
// someone deletes the one line that keeps the site from being blank.

const source = readFileSync(fileURLToPath(new URL("../src/scene.ts", import.meta.url)), "utf8");

// Comments stripped: the fix is documented in a comment that names the CDN it
// removed, and a bare text search would match that explanation and fail on the
// very file that fixes the bug.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the text field has a self-hosted font", () => {
  it("configures a default font before building any Text", () => {
    expect(source).toMatch(/configureTextBuilder\(\s*\{[^}]*defaultFontURL/);
  });

  it("bundles the font through Vite rather than naming a runtime URL", () => {
    // A bundled `?url` import is base-path-aware, so it survives deploying to
    // a GitHub Pages subpath. A literal "/fonts/…" resolves to the domain root
    // and 404s there while working perfectly on localhost.
    expect(source).toMatch(/import\s+fontURL\s+from\s+["'][^"']+\.woff\?url["']/);
    expect(source).not.toMatch(/defaultFontURL:\s*["']https?:/);
  });

  it("does not depend on a CDN for glyphs", () => {
    expect(code).not.toMatch(/jsdelivr|unpkg|gstatic|fonts\.googleapis/);
  });
});
