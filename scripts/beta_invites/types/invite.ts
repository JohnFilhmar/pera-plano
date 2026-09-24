import { z } from "zod";

/**
 * Everything the mailer needs, parsed once at startup from the environment.
 *
 * The defaults are Gmail's. SMTP_PASSWORD must be a Google App Password (16 characters,
 * generated at myaccount.google.com/apppasswords with 2-Step Verification on): Google has
 * refused plain account passwords over SMTP since 2022, and an account password here fails
 * with a 535 that says nothing useful.
 */
export const mailerEnvSchema = z.object({
  SMTP_HOST: z.string().trim().min(1).default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(465),
  SMTP_USER: z.string().trim().pipe(z.email("SMTP_USER must be the full Gmail address.")),
  // Gmail prints app passwords in groups of four. Accept what the user pasted and strip the
  // spaces, rather than failing on a copy that looks exactly like what Google showed them.
  SMTP_PASSWORD: z
    .string()
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(z.string().min(8, "SMTP_PASSWORD looks too short to be an app password.")),

  MAIL_FROM_NAME: z.string().trim().min(1).default("PeraPlano"),
  /** Defaults to SMTP_USER. Gmail rewrites any From it has not verified as an alias. */
  MAIL_FROM_EMAIL: z.string().trim().pipe(z.email()).optional(),
  MAIL_REPLY_TO: z.string().trim().pipe(z.email()).optional(),

  PLAY_STORE_URL: z
    .string()
    .trim()
    .pipe(z.url())
    .default("https://play.google.com/store/apps/details?id=com.filldev.peraplano"),
  /**
   * The closed-testing opt-in link, which is NOT the store link. Play Console shows it as
   * "Copy link" on the testers tab and it looks like
   * https://play.google.com/apps/testing/com.filldev.peraplano. A tester who only gets the
   * store link sees "item not found" until they have opted in through this one.
   */
  PLAY_OPT_IN_URL: z.string().trim().pipe(z.url()).optional(),
  BETA_PAGE_URL: z.string().trim().pipe(z.url()).default("https://peraplano.filhmar.online/en/beta"),
  SUPPORT_EMAIL: z.string().trim().pipe(z.email()).optional(),

  /** Gap between messages. Gmail throttles hard on bursts; 4 seconds is calm and still fast. */
  SEND_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(4000),
  /**
   * A free Gmail account is cut off at roughly 500 recipients per rolling 24 hours, and a
   * Workspace account at 2000. Stopping ourselves is better than having Google stop us
   * mid-run, because a Google-side cut-off gives no clean record of who was reached.
   */
  DAILY_LIMIT: z.coerce.number().int().positive().default(400),
});

export type MailerEnv = z.infer<typeof mailerEnvSchema>;

/**
 * One person from the /beta sheet. Column names match the Apps Script's HEADERS so a raw
 * CSV export needs no editing, with the obvious plain aliases accepted too.
 */
export const recipientSchema = z
  .object({
    google_email: z.string().optional(),
    email: z.string().optional(),
    first_name: z.string().optional(),
    name: z.string().optional(),
    device_model: z.string().optional(),
    status: z.string().optional(),
  })
  .transform((row, ctx) => {
    const raw = (row.google_email ?? row.email ?? "").trim().toLowerCase();
    const parsed = z.email().safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `Not an email address: "${raw}"` });
      return z.NEVER;
    }
    return {
      email: parsed.data,
      first_name: (row.first_name ?? row.name ?? "").trim(),
      device_model: (row.device_model ?? "").trim(),
      status: (row.status ?? "").trim(),
    };
  });

export type Recipient = z.infer<typeof recipientSchema>;

export interface RenderedInvite {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** One line of sent_log.jsonl. The log is the only record of who has already been mailed. */
export interface SendRecord {
  readonly email: string;
  readonly sent_at: string;
  readonly message_id: string;
}
