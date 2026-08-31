import { z } from "zod";

/**
 * The wire contract for /beta's form, shared by the client that submits it and the route
 * handler that validates it. Zod at the boundary, once, so the browser and the server
 * cannot disagree about what a valid submission is.
 *
 * Bumped whenever the consent wording on /beta materially changes. It is stored with every
 * row, so "which sentence did this person actually agree to" is answerable a year from now
 * without reading git history.
 */
export const CONSENT_VERSION = "2026-08-31";

/**
 * A bot fills every field it can see, including the ones a human cannot. The name is
 * deliberately boring — `company` gets filled by autofill heuristics far more often than
 * something called `honeypot_do_not_fill`.
 */
export const HONEYPOT_FIELD = "company";

/** Below this, nobody read the consent line, let alone typed an email. */
export const MIN_FILL_MS = 2500;

export const betaSignupSchema = z.object({
  // Play matches tester addresses case-insensitively, so normalising here means the
  // spreadsheet never holds the same person twice under different capitalisation.
  googleEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "That address is too long to be real.")
    .pipe(z.email("Enter the Google account email you use on the Play Store.")),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  // Optional and free text: a dropdown of Philippine Android models would be wrong within a
  // month, and the answer only has to be good enough to spot a device we are not covering.
  deviceModel: z.string().trim().max(120).default(""),
  // Literal true, not a boolean: `consent: false` is not a valid submission that happens to
  // be unticked, it is a submission we are not allowed to store.
  consent: z.literal(true),
  // Accepted as any string on purpose. Constraining it to empty here would make a filled
  // honeypot fail schema validation and answer 400, which tells a bot precisely that the
  // field is a trap. The route checks it separately and answers a bland success instead.
  [HONEYPOT_FIELD]: z.string().default(""),
  elapsedMs: z.number().int().nonnegative().default(0),
});

export type BetaSignupInput = z.infer<typeof betaSignupSchema>;

/** What the route answers. `duplicate` is a success: see the Apps Script for why. */
export interface BetaSignupResult {
  readonly ok: boolean;
  readonly duplicate?: boolean;
  readonly error?: "invalid" | "rate" | "closed" | "server";
}
