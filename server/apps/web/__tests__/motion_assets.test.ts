import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BRAND_DIR = `${WEB_ROOT}public/brand`;

/**
 * Why this file exists.
 *
 * Every animated asset in the brand delivery — the 1600x900 seven-plane background, the idle
 * loop, the one-shot launch, the layered mark, and all eight pagination glyphs — sat in the
 * repository referenced by nothing at all until the 2026-08-31 revamp, while
 * docs/14-design-revamp-prompt.md §4 said the web "is the one place the full SMIL animation
 * set can run natively". Nothing failed. Nothing warned. An unused asset is invisible, and it
 * stayed invisible for as long as nobody happened to grep for it.
 *
 * So the rule is now enforced rather than remembered: a file in public/brand that nothing
 * renders is a failing test, not a discovery someone makes later.
 *
 * Deleting an asset is a fine way to make this pass. Adding one and wiring it up is another.
 * Adding one and leaving it unwired is the case this exists to catch.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function sourceText(): string {
  const roots = [`${WEB_ROOT}app`, `${WEB_ROOT}components`];
  return roots
    .flatMap((root) => walk(root))
    .filter((file) => /\.(tsx?|css)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("brand assets", () => {
  const sources = sourceText();

  it("renders every file sitting at the top level of public/brand", () => {
    const files = readdirSync(BRAND_DIR).filter(
      (entry) => !statSync(`${BRAND_DIR}/${entry}`).isDirectory(),
    );
    // A guard that asserts over an empty list is not a guard.
    expect(files.length).toBeGreaterThan(0);

    const orphans = files.filter((file) => !sources.includes(file));
    expect(orphans).toEqual([]);
  });

  // The eight pagination glyphs are addressed by template, not by literal filename, so the
  // check above cannot see them. What has to hold instead is that the union of directions
  // NavGlyph accepts is exactly the set of files on disk — a ninth file, or a deleted one,
  // both show up here.
  it("keeps NavGlyph's direction union in step with the files in public/brand/nav", () => {
    const onDisk = readdirSync(`${BRAND_DIR}/nav`)
      .map((file) => /^nav-([a-z]+)\.svg$/.exec(file)?.[1])
      .filter((direction): direction is string => direction !== undefined)
      .sort();
    expect(onDisk.length).toBe(8);

    const glyph = readFileSync(`${WEB_ROOT}components/marketing/nav_glyph.tsx`, "utf8");
    const union = /export type NavDirection =([^;]+);/.exec(glyph)?.[1];
    if (union === undefined) throw new Error("NavGlyph no longer declares a NavDirection union");

    const declared = [...union.matchAll(/"([a-z]+)"/g)]
      .map((match) => match[1])
      .filter((direction): direction is string => direction !== undefined)
      .sort();
    expect(declared).toEqual(onDisk);
    expect(glyph).toContain("/brand/nav/nav-");
  });
});
