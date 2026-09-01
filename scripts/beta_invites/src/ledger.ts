import { appendFileSync, readFileSync } from "node:fs";
import type { SendRecord } from "@/types/invite";

/**
 * An append-only log of who has already been mailed, one JSON object per line.
 *
 * It exists because the failure this script must never have is sending a second invitation
 * to someone who already got one. A run that dies halfway, a laptop that sleeps, a Gmail
 * quota that trips: all of them end with a partially sent list, and the only safe way to
 * finish is to re-run the same command and have it skip what already went out. The line is
 * written immediately after each accepted message, not batched at the end.
 */
export function read_ledger(path: string): Set<string> {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return new Set();
  }

  const sent = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const record: unknown = JSON.parse(line);
      if (record && typeof record === "object" && "email" in record) {
        const email = (record as { email: unknown }).email;
        if (typeof email === "string") sent.add(email.trim().toLowerCase());
      }
    } catch {
      // A corrupted line is not worth aborting a send over, but it must not be silent:
      // treating it as "nobody" is the safe direction only because the operator sees this.
      process.stderr.write(`Skipping unreadable line in ${path}: ${line}\n`);
    }
  }
  return sent;
}

export function append_ledger(path: string, record: SendRecord): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}
