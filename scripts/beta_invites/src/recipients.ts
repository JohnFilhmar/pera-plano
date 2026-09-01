import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { recipientSchema } from "@/types/invite";
import type { Recipient } from "@/types/invite";

/**
 * RFC 4180 enough for a Google Sheets export: quoted fields, doubled quotes inside them,
 * and commas or newlines within quotes. A device model like `Redmi Note 12, 5G` is exactly
 * the value that breaks a split(",") parser, and it is a value real testers type.
 */
function parse_csv(contents: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < contents.length; i += 1) {
    const character = contents[i];
    if (quoted) {
      if (character === '"') {
        if (contents[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

function rows_from_csv(contents: string): Record<string, string>[] {
  const rows = parse_csv(contents);
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map((name) => name.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = row[index] ?? "";
    });
    return record;
  });
}

function rows_from_json(contents: string): Record<string, string>[] {
  const parsed: unknown = JSON.parse(contents);
  if (!Array.isArray(parsed)) {
    throw new Error("A JSON recipients file must contain an array.");
  }
  return parsed.map((entry) => {
    if (typeof entry === "string") return { email: entry };
    if (entry && typeof entry === "object") return entry as Record<string, string>;
    throw new Error(`Unusable entry in JSON recipients file: ${JSON.stringify(entry)}`);
  });
}

function rows_from_lines(contents: string): Record<string, string>[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((email) => ({ email }));
}

export interface LoadedRecipients {
  readonly recipients: readonly Recipient[];
  readonly duplicates: readonly string[];
  readonly rejected: readonly string[];
}

/**
 * Reads the tester list from a .csv export of the beta_signups sheet, a .json array, or a
 * plain .txt list of addresses. Rejected rows are returned rather than thrown, because one
 * mistyped address in a list of eighty should not stop the other seventy-nine going out.
 */
export function load_recipients(path: string): LoadedRecipients {
  const contents = readFileSync(path, "utf8");
  const extension = extname(path).toLowerCase();
  const rows =
    extension === ".json"
      ? rows_from_json(contents)
      : extension === ".txt"
        ? rows_from_lines(contents)
        : rows_from_csv(contents);

  const recipients: Recipient[] = [];
  const duplicates: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const parsed = recipientSchema.safeParse(row);
    if (!parsed.success) {
      rejected.push(`${JSON.stringify(row)} (${parsed.error.issues[0]?.message ?? "invalid"})`);
      continue;
    }
    if (seen.has(parsed.data.email)) {
      duplicates.push(parsed.data.email);
      continue;
    }
    seen.add(parsed.data.email);
    recipients.push(parsed.data);
  }

  return { recipients, duplicates, rejected };
}
