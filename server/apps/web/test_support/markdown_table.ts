export interface MarkdownTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Walks the line tracking backslash escapes instead of calling String.split('|').
 * Privacy §4 row 4 contains `tier: free \| plus`; a naive split passes every other row
 * in that table and quietly turns one row into two cells.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      current += char + String(line[i + 1]);
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char ?? "";
  }
  cells.push(current);
  // "| a | b |" yields a leading and a trailing empty cell.
  if (cells.length > 0 && cells[0]?.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

export function normalizeCell(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link text only; the target is a repo path
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSection(markdown: string, headingLine: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) {
    const found = lines.filter((line) => line.startsWith("## ")).join("\n  ");
    throw new Error(
      `extractSection: heading ${JSON.stringify(headingLine)} not found. ` +
        `Headings present:\n  ${found}`,
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function parseFirstTable(section: string): MarkdownTable {
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex(
    (line, index) =>
      line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[index + 1] ?? ""),
  );
  if (headerIndex === -1) {
    throw new Error("parseFirstTable: no markdown table found in the given section");
  }
  const headers = splitRow(lines[headerIndex] ?? "").map(normalizeCell);
  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(splitRow(line).map(normalizeCell));
  }
  return { headers, rows };
}

export function extractStatusLine(markdown: string): string {
  const match = /^\*\*Status:\*\*\s*(.+)$/m.exec(markdown);
  if (match?.[1] === undefined) {
    throw new Error("extractStatusLine: no '**Status:**' line found");
  }
  return match[1].trim();
}
