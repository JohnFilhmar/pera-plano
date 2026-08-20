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
  const parsed = rowMatches.map((row) =>
    [...(row[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
      stripTags(cell[2] ?? ""),
    ),
  );
  const [headers, ...rows] = parsed;
  return { headers: headers ?? [], rows };
}
