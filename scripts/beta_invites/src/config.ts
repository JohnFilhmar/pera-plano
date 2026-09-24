import { readFileSync } from "node:fs";
import { mailerEnvSchema } from "@/types/invite";
import type { MailerEnv } from "@/types/invite";

/**
 * A five-line .env reader, so the script has no runtime dependency on dotenv and works the
 * same whether the credentials come from a file or from the shell. Real values are only
 * ever in a gitignored .env; nothing here writes one.
 */
function read_env_file(path: string): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/**
 * Environment in, typed config out, once, at startup. An empty string is treated as unset:
 * `SEND_DELAY_MS=` in a half-filled .env should fall back to the default rather than coerce
 * to zero and fire every message at once.
 */
export function load_config(env_path = ".env"): MailerEnv {
  const merged: Record<string, string> = { ...read_env_file(env_path) };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value !== "") merged[key] = value;
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === "") delete merged[key];
  }

  const parsed = mailerEnvSchema.safeParse(merged);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Configuration is not usable:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export function from_address(config: MailerEnv): string {
  const address = config.MAIL_FROM_EMAIL ?? config.SMTP_USER;
  return `"${config.MAIL_FROM_NAME.replace(/"/g, "")}" <${address}>`;
}
