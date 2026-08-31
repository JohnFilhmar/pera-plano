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

/**
 * Where the /beta signup form sends a submission. Deliberately NOT a COMPLIANCE_FIELD:
 * those abort production boot when unset, which is right for a legal identifier published
 * on a notice and wrong for this. A missing webhook means one optional page cannot take
 * submissions; it must not stop the privacy notice being served.
 *
 * Undefined when either half is absent or the URL is unusable, so callers get one thing to
 * check rather than two half-configured strings. The page renders a "not open yet" state
 * and the route answers 503 — the same principle as `requiredMarker`: show the truth, never
 * a control that silently does nothing.
 */
export interface BetaSignupConfig {
  readonly webhookUrl: string;
  readonly token: string;
}

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly logLevel: LogLevel;
  readonly publicBaseUrl: string;
  readonly contacts: ComplianceContacts;
  readonly betaSignup: BetaSignupConfig | undefined;
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
      betaSignup: readBetaSignup(raw),
    },
    missing,
  };
}

/**
 * Both halves or neither. A URL without a token would post unauthenticated submissions to a
 * public endpoint, and a token without a URL has nowhere to go — either way the honest
 * answer is "not configured", not "configured badly".
 *
 * A malformed URL is treated as absent rather than thrown, deliberately: this function runs
 * during `next build`, and a typo in an optional integration must not make the whole site
 * uncompilable. The page then says signups are closed, which is true.
 */
function readBetaSignup(
  raw: Readonly<Record<string, string | undefined>>,
): BetaSignupConfig | undefined {
  const webhookUrl = raw["BETA_SIGNUP_WEBHOOK_URL"]?.trim() ?? "";
  const token = raw["BETA_SIGNUP_TOKEN"]?.trim() ?? "";
  if (webhookUrl === "" || token === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return undefined;
  }
  // Google issues these over https; anything else means a misconfiguration that would send
  // an email address over the wire in the clear.
  if (parsed.protocol !== "https:") return undefined;
  return { webhookUrl, token };
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
