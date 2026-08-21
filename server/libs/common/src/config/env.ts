import { z } from "zod";

/**
 * The values that appear verbatim in the published privacy notice and support page.
 * As of 2026-08-20 none of them is known. Writing a plausible value for any of them
 * publishes a false legal identifier, which is worse than an outage — see the spec's
 * §5.2 for why the two failure modes below are deliberately different.
 */
export const COMPLIANCE_FIELDS = [
  "PIC_LEGAL_NAME",
  "PIC_ADDRESS",
  "DPO_NAME",
  "DPO_EMAIL",
  "SUPPORT_EMAIL",
  "NPC_REGISTRATION",
] as const;

export type ComplianceField = (typeof COMPLIANCE_FIELDS)[number];
export type ComplianceContacts = Readonly<Record<ComplianceField, string>>;
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Why each field exists, quoted into the boot error so an operator at 2am gets the citation. */
const FIELD_PURPOSE: Readonly<Record<ComplianceField, string>> = {
  PIC_LEGAL_NAME: "legal name of the Personal Information Controller (privacy §2.1, §2.4)",
  PIC_ADDRESS: "registered address of the Controller (privacy §2.4)",
  DPO_NAME: "appointed Data Protection Officer (privacy §2.5)",
  DPO_EMAIL: "Data Protection Officer contact (privacy §2.4, §2.5)",
  SUPPORT_EMAIL: "support mailbox (privacy §2.3; Play listing requirement)",
  NPC_REGISTRATION: "NPC registration status (privacy §2.5)",
};

const EMAIL_FIELDS = new Set<ComplianceField>(["DPO_EMAIL", "SUPPORT_EMAIL"]);

export const DEFAULT_PUBLIC_BASE_URL = "https://peraplano.filhmar.online";

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly logLevel: LogLevel;
  readonly publicBaseUrl: string;
  readonly contacts: ComplianceContacts;
}

export interface EnvParseResult {
  readonly config: AppConfig;
  readonly missing: readonly ComplianceField[];
}

export class InvalidConfigError extends Error {
  override readonly name = "InvalidConfigError";
}

export class MissingComplianceConfigError extends Error {
  override readonly name = "MissingComplianceConfigError";
  readonly missing: readonly ComplianceField[];

  constructor(missing: readonly ComplianceField[]) {
    const lines = missing.map((field) => `  ${field} — ${FIELD_PURPOSE[field]}`).join("\n");
    super(
      `Refusing to start: ${missing.length} required compliance ` +
        `${missing.length === 1 ? "value is" : "values are"} not configured.\n\n${lines}\n\n` +
        "These appear in the published privacy notice. Set them in server/.env.local " +
        "(see server/.env.example) and restart. They are never baked into the image.",
    );
    this.missing = missing;
  }
}

/** The literal a page renders in place of an unsupplied value. Asserted by tests; do not restyle. */
export function requiredMarker(field: ComplianceField): string {
  return `[ REQUIRED: ${field} ]`;
}

const emailSchema = z.email();

const operationalSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function readBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return DEFAULT_PUBLIC_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidConfigError(
      `PUBLIC_BASE_URL is not an absolute URL: ${JSON.stringify(value)}. ` +
        `Expected something like ${DEFAULT_PUBLIC_BASE_URL}.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidConfigError(`PUBLIC_BASE_URL must use http or https, got ${parsed.protocol}`);
  }
  // Strip trailing slashes once, here, so nothing downstream has to remember to.
  return value.replace(/\/+$/, "");
}

/**
 * Pure. NEVER throws for a missing compliance field — that decision belongs to
 * assertProductionConfig, which is called from the server's boot hook only. If this
 * threw, `next build` (which runs with NODE_ENV=production and without the runtime
 * env_file) could not compile the app at all.
 */
export function parseEnvironment(
  raw: Readonly<Record<string, string | undefined>>,
): EnvParseResult {
  const operational = operationalSchema.safeParse({
    NODE_ENV: raw["NODE_ENV"],
    LOG_LEVEL: raw["LOG_LEVEL"],
  });
  if (!operational.success) {
    throw new InvalidConfigError(
      operational.error.issues
        .map((issue) => `${String(issue.path[0])}: ${issue.message}`)
        .join("; "),
    );
  }

  const publicBaseUrl = readBaseUrl(raw["PUBLIC_BASE_URL"]);

  const missing: ComplianceField[] = [];
  const contacts = {} as Record<ComplianceField, string>;
  for (const field of COMPLIANCE_FIELDS) {
    const value = raw[field]?.trim() ?? "";
    // A malformed contact address is not better than an absent one: publishing
    // "dpo@" satisfies a presence check and reaches nobody.
    const usable =
      value !== "" && (!EMAIL_FIELDS.has(field) || emailSchema.safeParse(value).success);
    if (usable) {
      contacts[field] = value;
    } else {
      contacts[field] = requiredMarker(field);
      missing.push(field);
    }
  }

  return {
    config: {
      nodeEnv: operational.data.NODE_ENV,
      logLevel: operational.data.LOG_LEVEL,
      publicBaseUrl,
      contacts,
    },
    missing,
  };
}

/** Called from apps/web/instrumentation.ts only. See the spec's §5.3. */
export function assertProductionConfig(result: EnvParseResult): void {
  if (result.missing.length > 0) throw new MissingComplianceConfigError(result.missing);
}

let cached: AppConfig | undefined;

/**
 * For route files, which run per request. Memoised because process.env does not change
 * after boot; content components take AppConfig as a prop instead, which is what keeps
 * them renderable in a test without touching the environment.
 */
export function getConfig(): AppConfig {
  cached ??= parseEnvironment(process.env).config;
  return cached;
}
