import { describe, expect, it } from "vitest";
import {
  extractSection,
  extractStatusLine,
  normalizeCell,
  parseFirstTable,
  splitRow,
} from "@/test_support/markdown_table.js";

describe("splitRow", () => {
  it("splits on unescaped pipes and drops the leading and trailing empties", () => {
    expect(splitRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  // Privacy §4 row 4 contains `tier: free \| plus`. A naive String.split('|') passes
  // every other row in the table and silently corrupts this one.
  it("keeps an escaped pipe inside its cell", () => {
    expect(splitRow("| 4 | tier: free \\| plus | on-device |")).toEqual([
      "4",
      "tier: free \\| plus",
      "on-device",
    ]);
  });
});

describe("normalizeCell", () => {
  it("strips bold", () => {
    expect(normalizeCell("**30-day TTL, then purged**")).toBe("30-day TTL, then purged");
  });
  it("strips backticks", () => {
    expect(normalizeCell("`rawNotificationRef`")).toBe("rawNotificationRef");
  });
  it("keeps link text and drops the repo-relative target", () => {
    expect(normalizeCell("see [08-risks-and-open-questions.md](08-risks-and-open-questions.md)")).toBe(
      "see 08-risks-and-open-questions.md",
    );
  });
  it("unescapes an escaped pipe", () => {
    expect(normalizeCell("tier: free \\| plus")).toBe("tier: free | plus");
  });
  it("collapses runs of whitespace", () => {
    expect(normalizeCell("  a   b  ")).toBe("a b");
  });
});

describe("extractSection", () => {
  const doc = "# T\n\n## 3. A\n\nalpha\n\n## 4. Data lifecycle\n\nbeta\n\n## 5. B\n\ngamma\n";

  it("returns only the requested section", () => {
    const section = extractSection(doc, "## 4. Data lifecycle");
    expect(section).toContain("beta");
    expect(section).not.toContain("alpha");
    expect(section).not.toContain("gamma");
  });

  it("throws and names the headings it found, so a renamed heading is not a silent pass", () => {
    expect(() => extractSection(doc, "## 4. Data lifecycles")).toThrow(/## 4\. Data lifecycle/);
  });
});

describe("parseFirstTable", () => {
  it("reads headers and rows and ignores the alignment row", () => {
    const table = parseFirstTable("text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nmore");
    expect(table.headers).toEqual(["A", "B"]);
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("throws when the section has no table, rather than returning an empty one", () => {
    expect(() => parseFirstTable("just prose")).toThrow(/no markdown table/i);
  });
});

describe("extractStatusLine", () => {
  it("pulls the document's own status line so a page cannot claim a freshness it lacks", () => {
    expect(extractStatusLine("# T\n\n**Status:** Draft v1 · 2026-08-02\n\n---\n")).toBe(
      "Draft v1 · 2026-08-02",
    );
  });
});
