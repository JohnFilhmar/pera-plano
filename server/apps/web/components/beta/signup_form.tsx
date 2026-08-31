"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale, Messages } from "@/messages/index";
import { HONEYPOT_FIELD, betaSignupSchema, type BetaSignupResult } from "@/types/beta_signup";
import styles from "./signup_form.module.css";

/** FormData.get is `string | File | null`; a File stringifies to "[object Object]". */
function readField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

type Form = Messages["beta"]["form"];
type Outcome = "idle" | "sending" | "ok" | "duplicate" | "error";
type FieldName = "googleEmail" | "firstName" | "consent";

/**
 * The only form on the site, and the only place a visitor hands over anything.
 *
 * It is a real <form> with a real action, not a div with a click handler. Without
 * JavaScript it posts to the same route, which content-negotiates and sends the reader back
 * to /beta?submitted=… — so a person with scripting off can still join, and the states they
 * see are the ones rendered by the page rather than nothing at all.
 *
 * Validation runs against the same Zod schema the route uses, so the message a field shows
 * and the reason the server would reject it cannot drift apart.
 */
export function SignupForm({
  form,
  locale,
  initialOutcome,
}: {
  form: Form;
  locale: Locale;
  /** Set from ?submitted= when the no-JavaScript path bounced back here. */
  initialOutcome: Outcome;
}) {
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string>("");
  const mountedAt = useRef<number>(0);
  const liveRegion = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Used only for the fill-time floor. It is a bot check, not analytics: nothing is sent
    // anywhere except the elapsed milliseconds, and only to our own route.
    mountedAt.current = Date.now();
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const candidate = {
      googleEmail: readField(data, "googleEmail"),
      firstName: readField(data, "firstName"),
      deviceModel: readField(data, "deviceModel"),
      consent: data.get("consent") !== null,
      [HONEYPOT_FIELD]: readField(data, HONEYPOT_FIELD),
      elapsedMs: Date.now() - mountedAt.current,
    };

    const parsed = betaSignupSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "googleEmail") next.googleEmail = form.errors.email;
        else if (field === "firstName") next.firstName = form.errors.firstName;
        else if (field === "consent") next.consent = form.errors.consent;
      }
      setFieldErrors(next);
      setFormError("");
      setOutcome("idle");
      return;
    }

    setFieldErrors({});
    setFormError("");
    setOutcome("sending");

    try {
      const response = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = (await response.json()) as BetaSignupResult;

      if (result.ok) {
        setOutcome(result.duplicate === true ? "duplicate" : "ok");
        return;
      }
      setOutcome("error");
      setFormError(
        result.error === "rate"
          ? form.errors.rate
          : result.error === "closed"
            ? form.errors.closed
            : form.errors.server,
      );
    } catch {
      setOutcome("error");
      setFormError(form.errors.server);
    }
  };

  if (outcome === "ok" || outcome === "duplicate") {
    const heading = outcome === "duplicate" ? form.duplicateHeading : form.successHeading;
    const body = outcome === "duplicate" ? form.duplicateBody : form.successBody;
    return (
      <div className={styles.done} role="status">
        <h3 className={styles.doneHeading}>{heading}</h3>
        <p className={styles.doneBody}>{body}</p>
      </div>
    );
  }

  const sending = outcome === "sending";

  return (
    <form
      className={styles.form}
      method="post"
      action="/api/beta-signup"
      onSubmit={(event) => { void submit(event); }}
      noValidate
    >
      <input type="hidden" name="locale" value={locale} />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="googleEmail">
          {form.emailLabel}
        </label>
        <p className={styles.hint} id="googleEmail-hint">
          {form.emailHint}
        </p>
        <input
          className={styles.input}
          id="googleEmail"
          name="googleEmail"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          aria-describedby={
            fieldErrors.googleEmail === undefined ? "googleEmail-hint" : "googleEmail-error"
          }
          aria-invalid={fieldErrors.googleEmail !== undefined}
        />
        {fieldErrors.googleEmail !== undefined ? (
          <p className={styles.error} id="googleEmail-error">
            {fieldErrors.googleEmail}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="firstName">
          {form.firstNameLabel}
        </label>
        <p className={styles.hint} id="firstName-hint">
          {form.firstNameHint}
        </p>
        <input
          className={styles.input}
          id="firstName"
          name="firstName"
          type="text"
          autoComplete="given-name"
          required
          maxLength={80}
          aria-describedby={
            fieldErrors.firstName === undefined ? "firstName-hint" : "firstName-error"
          }
          aria-invalid={fieldErrors.firstName !== undefined}
        />
        {fieldErrors.firstName !== undefined ? (
          <p className={styles.error} id="firstName-error">
            {fieldErrors.firstName}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="deviceModel">
          {form.deviceLabel}
        </label>
        <p className={styles.hint} id="deviceModel-hint">
          {form.deviceHint}
        </p>
        <input
          className={styles.input}
          id="deviceModel"
          name="deviceModel"
          type="text"
          maxLength={120}
          placeholder={form.devicePlaceholder}
          aria-describedby="deviceModel-hint"
        />
      </div>

      {/* Never rendered to a person: off-screen rather than display:none, because some bots
          skip fields the browser reports as hidden. tabIndex and autocomplete keep it out
          of a keyboard user's path and out of autofill. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={HONEYPOT_FIELD}>Company</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className={styles.consent}>
        <input
          className={styles.checkbox}
          id="consent"
          name="consent"
          type="checkbox"
          required
          aria-describedby={fieldErrors.consent === undefined ? undefined : "consent-error"}
          aria-invalid={fieldErrors.consent !== undefined}
        />
        <label className={styles.consentLabel} htmlFor="consent">
          {form.consentLabel}
        </label>
      </div>
      {fieldErrors.consent !== undefined ? (
        <p className={styles.error} id="consent-error">
          {fieldErrors.consent}
        </p>
      ) : null}

      <button className={styles.submit} type="submit" disabled={sending}>
        {sending ? form.submittingLabel : form.submitLabel}
      </button>

      <div className={styles.live} ref={liveRegion} role="alert">
        {formError === "" ? null : (
          <p className={styles.formError}>
            <strong>{form.errorHeading}</strong> {formError}
          </p>
        )}
      </div>
    </form>
  );
}
