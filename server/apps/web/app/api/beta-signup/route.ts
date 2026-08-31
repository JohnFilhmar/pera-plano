import { getConfig, readOrCreateRequestId } from "@peraplano/common";
import {
  CONSENT_VERSION,
  HONEYPOT_FIELD,
  MIN_FILL_MS,
  betaSignupSchema,
  type BetaSignupResult,
} from "@/types/beta_signup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The only endpoint on this site that accepts personal data, which is the whole reason it
 * is written as carefully as it is.
 *
 * WHAT IS NEVER LOGGED: the email address, the first name, the device, or the token. A log
 * line gets the request id and an outcome word. A privacy notice promising a short
 * retention window means nothing if the same address is sitting in an application log
 * forever, and log retention is not something this page controls.
 *
 * RATE LIMITING is a honeypot, a fill-time floor, and a small in-memory per-IP counter.
 * That is weaker than the Redis-backed limiter the backend baseline asks for, and it is
 * stated here rather than quietly skipped: this app has no Redis and no session store, the
 * endpoint writes one row to a spreadsheet, and the Apps Script deduplicates by email on
 * the far side. If the list ever attracts real abuse, the fix is a limiter in front of the
 * app, not more code here.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

/**
 * Per-process and deliberately unbounded in precision but bounded in size: entries are
 * dropped as they expire, so a long-running instance does not accumulate one key per IP
 * seen since boot. Resets on deploy, which is acceptable for what it defends.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now: number): boolean {
  const entry = attempts.get(key);
  if (entry === undefined || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic sweep: cheaper than a timer, and the map only grows while traffic does.
    if (attempts.size > 512) {
      for (const [candidate, value] of attempts) {
        if (now > value.resetAt) attempts.delete(candidate);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : "unknown";
}

function answer(result: BetaSignupResult, status: number): Response {
  return Response.json(result, { status });
}

/**
 * Without JavaScript the form is a plain HTML POST, which lands here as
 * `application/x-www-form-urlencoded` and cannot do anything useful with a JSON body. Those
 * submissions get a 303 back to /beta carrying the outcome in the query string, so the page
 * can render the same success and error states it would have rendered in the browser.
 *
 * The locale rides along in a hidden field because this route sits outside the [locale]
 * segment and has no other way to know where to send the reader back to.
 */
function isFormPost(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  );
}

/**
 * FormData.get returns `string | File | null`. A File coerced with String() becomes the
 * literal "[object Object]", which would sail through a max-length check and land in the
 * spreadsheet. Anything that is not a string is treated as absent.
 */
function readField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function redirectBack(locale: string, outcome: string): Response {
  const safeLocale = /^[a-z]{2}$/.test(locale) ? locale : "en";
  return Response.redirect(
    `/${safeLocale}/beta?submitted=${encodeURIComponent(outcome)}#join`,
    303,
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = readOrCreateRequestId(request.headers);
  const config = getConfig();
  const formPost = isFormPost(request);
  let locale = "en";

  if (config.betaSignup === undefined) {
    // Not an error condition: the deployment has no webhook yet. The page already renders
    // its "not open" state, so this only catches a direct POST.
    return formPost ? redirectBack(locale, "closed") : answer({ ok: false, error: "closed" }, 503);
  }

  if (rateLimited(clientKey(request), Date.now())) {
    return formPost ? redirectBack(locale, "rate") : answer({ ok: false, error: "rate" }, 429);
  }

  let body: unknown;
  try {
    if (formPost) {
      const form = await request.formData();
      const submittedLocale = readField(form, "locale");
      if (submittedLocale !== "") locale = submittedLocale;
      body = {
        googleEmail: readField(form, "googleEmail"),
        firstName: readField(form, "firstName"),
        deviceModel: readField(form, "deviceModel"),
        // An unticked checkbox is simply absent from the payload, so this becomes `false`
        // and the literal-true schema rejects it, which is the intended outcome.
        consent: form.get("consent") !== null,
        [HONEYPOT_FIELD]: readField(form, HONEYPOT_FIELD),
        // No timing check is possible without a clock the client controls; a form post
        // carries no elapsed time. The honeypot still applies.
        elapsedMs: MIN_FILL_MS,
      };
    } else {
      body = await request.json();
    }
  } catch {
    return formPost ? redirectBack(locale, "invalid") : answer({ ok: false, error: "invalid" }, 400);
  }

  const parsed = betaSignupSchema.safeParse(body);
  if (!parsed.success) {
    return formPost ? redirectBack(locale, "invalid") : answer({ ok: false, error: "invalid" }, 400);
  }
  const input = parsed.data;

  // A filled honeypot, or a form completed faster than a person can read the consent line,
  // gets a bland success. Telling a bot which check caught it is free tuning information;
  // the row simply never gets written.
  if (input[HONEYPOT_FIELD] !== "" || input.elapsedMs < MIN_FILL_MS) {
    return formPost ? redirectBack(locale, "ok") : answer({ ok: true, duplicate: false }, 200);
  }

  try {
    const upstream = await fetch(config.betaSignup.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: config.betaSignup.token,
        google_email: input.googleEmail,
        first_name: input.firstName,
        device_model: input.deviceModel,
        consent_version: CONSENT_VERSION,
        source: "web",
        request_id: requestId,
      }),
      // Apps Script answers in well under a second when warm and can take several when
      // cold. Without a ceiling a hung upstream would hold the request open indefinitely.
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!upstream.ok) {
      return formPost ? redirectBack(locale, "server") : answer({ ok: false, error: "server" }, 502);
    }

    const payload = (await upstream.json()) as { ok?: boolean; duplicate?: boolean };
    if (payload.ok !== true) {
      return formPost ? redirectBack(locale, "server") : answer({ ok: false, error: "server" }, 502);
    }

    const duplicate = payload.duplicate === true;
    return formPost
      ? redirectBack(locale, duplicate ? "duplicate" : "ok")
      : answer({ ok: true, duplicate }, 200);
  } catch {
    // Network failure, timeout, or a non-JSON body from a misconfigured deployment. The
    // caller gets one word; the address is not written anywhere, including here.
    return formPost ? redirectBack(locale, "server") : answer({ ok: false, error: "server" }, 502);
  }
}
