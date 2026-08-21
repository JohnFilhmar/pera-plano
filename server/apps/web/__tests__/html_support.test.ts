import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractTable,
  firstHeadingText,
  sectionHeadingText,
  stripTags,
} from "@/test_support/html.js";

describe("html test support", () => {
  it("decodes the five entities React escapes", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#x27;")).toBe(
      `a & b <c> "d" 'e'`,
    );
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<p>a <strong>b</strong>\n  c</p>")).toBe("a b c");
  });

  it("finds the first heading's text", () => {
    expect(firstHeadingText('<div><h1 class="x">Privacy <em>notice</em></h1></div>')).toBe(
      "Privacy notice",
    );
  });

  it("extracts a table by its data-table-id and ignores every other table", () => {
    const html =
      '<table data-table-id="other"><tbody><tr><td>no</td></tr></tbody></table>' +
      '<table data-table-id="lifecycle"><caption>c</caption>' +
      "<thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2 &amp; 3</td></tr></tbody></table>";
    expect(extractTable(html, "lifecycle")).toEqual({
      headers: ["A", "B"],
      rows: [["1", "2 & 3"]],
    });
  });

  it("throws when the table id is absent, so a renamed table cannot pass vacuously", () => {
    expect(() => extractTable("<p>nothing</p>", "lifecycle")).toThrow(/lifecycle/);
  });

  it("throws when the matching table has no <tr> elements, so a gutted table cannot pass as an empty-vs-empty match", () => {
    const html = '<table data-table-id="lifecycle"><caption>c</caption></table>';
    expect(() => extractTable(html, "lifecycle")).toThrow(/lifecycle/);
    expect(() => extractTable(html, "lifecycle")).toThrow(/no <tr> rows/);
  });

  it("reads the heading inside a section, so an anchor alone is not enough to pass", () => {
    const html =
      '<section id="a"><h2>Who is <em>responsible</em></h2><h3>sub</h3></section>' +
      '<section id="b"><h2>Other</h2></section>';
    expect(sectionHeadingText(html, "a")).toBe("Who is responsible");
    expect(sectionHeadingText(html, "b")).toBe("Other");
  });

  it("throws for a section that kept its anchor but lost its heading", () => {
    expect(() => sectionHeadingText('<section id="a"><h3>sub</h3></section>', "a")).toThrow(
      /no <h2> heading/,
    );
    expect(() => sectionHeadingText("<p>nothing</p>", "a")).toThrow(/no <section id="a">/);
  });
});
