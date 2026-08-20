import type { MarkdownTable } from "./markdown_table.js";

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

export function decodeEntities(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (match) => ENTITIES[match] ?? match);
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function firstHeadingText(html: string): string {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (match?.[1] === undefined) throw new Error("firstHeadingText: no <h1> in the rendered HTML");
  return stripTags(match[1]);
}

/**
 * Deliberately throws rather than returning an empty table: a renamed data-table-id must
 * fail the drift test loudly, not turn it into a comparison of two empty arrays.
 */
export function extractTable(html: string, tableId: string): MarkdownTable {
  const pattern = new RegExp(
    `<table\\b[^>]*data-table-id="${tableId}"[^>]*>([\\s\\S]*?)</table>`,
    "i",
  );
  const match = pattern.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(`extractTable: no <table data-table-id="${tableId}"> in the rendered HTML`);
  }
  const body = match[1];
  const rowMatches = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  // A matching table with zero <tr> elements (e.g. a caption-only fragment, or markup that
  // lost its <thead>/<tbody> content) must not silently become { headers: [], rows: [] } —
  // that is exactly the empty-vs-empty comparison this parser exists to prevent.
  if (rowMatches.length === 0) {
    throw new Error(
      `extractTable: <table data-table-id="${tableId}"> has no <tr> rows in the rendered HTML`,
    );
  }
  const parsed = rowMatches.map((row) =>
    [...(row[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
      stripTags(cell[2] ?? ""),
    ),
  );
  const [headers, ...rows] = parsed;
  return { headers: headers ?? [], rows };
}

/**
 * The section-level `<h2>` text inside the `<section>` carrying `id="<anchorId>"`.
 *
 * Asserting only that `id="who-is-responsible"` appears in the markup passes for a section
 * gutted down to its own opening tag — the anchor survives every edit that deletes the
 * content beneath it. RA 10173 §2.4 requires the notice to *contain* each item, not merely
 * to keep a link target for it, so the guard has to read the heading.
 *
 * It looks for `<h2>` specifically, not "the first heading of any level". Sections on these
 * pages nest `<h3>`s inside sub-blocks (ContactBlock, Callout, the lifecycle invariants
 * list). A first-heading-wins version was written and then mutation-tested: deleting the
 * section's own `<h2>` still passed, because it found a ContactBlock's `<h3>`. Targeting the
 * level that every page uses for its section headings is what makes the guard bite.
 *
 * Written with indexOf scans and backslash-free patterns on purpose: a regex escape lost to
 * one layer of quoting would not fail here, it would quietly make this guard vacuous, which
 * is the same failure mode again.
 */
export function sectionHeadingText(html: string, anchorId: string): string {
  const opener = new RegExp('<section[^>]* id="' + anchorId + '"[^>]*>', "i").exec(html);
  if (opener === null) {
    throw new Error(`sectionHeadingText: no <section id="${anchorId}"> in the rendered HTML`);
  }
  const bodyStart = opener.index + opener[0].length;
  const bodyEnd = html.indexOf("</section>", bodyStart);
  if (bodyEnd === -1) {
    throw new Error(`sectionHeadingText: <section id="${anchorId}"> is never closed`);
  }
  const body = html.slice(bodyStart, bodyEnd);

  const heading = /<h2[^>]*>/i.exec(body);
  if (heading === null) {
    throw new Error(`sectionHeadingText: <section id="${anchorId}"> has no <h2> heading`);
  }
  const textStart = heading.index + heading[0].length;
  const textEnd = body.indexOf("</h2>", textStart);
  if (textEnd === -1) {
    throw new Error(`sectionHeadingText: <section id="${anchorId}"> has an unclosed <h2>`);
  }
  return stripTags(body.slice(textStart, textEnd));
}
