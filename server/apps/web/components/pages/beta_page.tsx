import type { AppConfig } from "@peraplano/common";
import { SignupForm } from "@/components/beta/signup_form";
import { RevealRoot } from "@/components/marketing/reveal_root";
import type { Locale, Messages } from "@/messages/index";
import styles from "./beta_page.module.css";

/**
 * The recruitment page, and the only surface on this site that asks a visitor for anything.
 *
 * Three things it is deliberately built around.
 *
 * IT ASKS BEFORE IT OFFERS THE FORM. The work section sits above the form on purpose: a
 * closed test filled with people who installed the app and never opened it is worse than a
 * shorter list, so the page states the commitment before it collects the address.
 *
 * IT NEVER PRETENDS TO BE OPEN. When `config.betaSignup` is undefined — no Apps Script
 * webhook configured — the form is replaced by a notice pointing at the support mailbox
 * rather than by a control that silently fails. Same rule the compliance values follow:
 * render the truth, never a button that goes nowhere.
 *
 * THE PROMISE LIVES ON /terms. "Plus free for life" is a commercial representation, and
 * this repo already routes those to the terms page rather than restating them wherever they
 * are convenient. This page makes the offer and points at the clause that binds it.
 *
 * No amount, price or currency figure appears anywhere on this page.
 */
export function BetaPage({
  messages,
  config,
  locale,
  submitted,
}: {
  messages: Messages;
  config: AppConfig;
  locale: Locale;
  /** From ?submitted= — set only when the no-JavaScript form post bounced back here. */
  submitted?: string | undefined;
}) {
  const b = messages.beta;
  const open = config.betaSignup !== undefined;

  const initialOutcome =
    submitted === "ok"
      ? "ok"
      : submitted === "duplicate"
        ? "duplicate"
        : submitted === undefined
          ? "idle"
          : "error";

  return (
    <article className={styles.page}>
      <RevealRoot />

      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.heroEyebrow}>{b.eyebrow}</p>
          <h1 className={styles.tagline}>{b.tagline}</h1>
          <p className={styles.lede}>{b.lede}</p>
          <a className={styles.scrollCue} href={b.scrollCueTarget}>
            {b.scrollCue}
          </a>
        </div>
      </header>

      <section id="what-you-get" className={styles.section}>
        <p className={styles.eyebrow}>{b.offer.eyebrow}</p>
        <h2>{b.offer.heading}</h2>
        <div className={styles.offers}>
          {b.offer.items.map((item, index) => (
            <div
              key={item.title}
              className={styles.offer}
              data-reveal
              style={{ "--reveal-delay": `${index * 80}ms` } as React.CSSProperties}
            >
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="what-we-ask" className={styles.section}>
        <p className={styles.eyebrow}>{b.asks.eyebrow}</p>
        <h2>{b.asks.heading}</h2>
        <p className={styles.lede2}>{b.asks.lede}</p>
        <ul className={styles.asks}>
          {b.asks.items.map((item, index) => (
            <li
              key={item}
              data-reveal
              style={{ "--reveal-delay": `${index * 70}ms` } as React.CSSProperties}
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section id="why-google-email" className={styles.section}>
        <p className={styles.eyebrow}>{b.why.eyebrow}</p>
        <h2>{b.why.heading}</h2>
        <p>{b.why.body}</p>
        {/* Said plainly and given its own emphasis, because "give us your Google account
            email" is exactly the shape of a phishing request and a reader is right to
            hesitate. The answer to that hesitation is a sentence, not a smaller font. */}
        <p className={styles.passwordNote}>{b.why.passwordNote}</p>
      </section>

      <section id="join" className={styles.section}>
        <p className={styles.eyebrow}>{b.form.eyebrow}</p>
        <h2>{b.form.heading}</h2>
        {open ? (
          <SignupForm form={b.form} locale={locale} initialOutcome={initialOutcome} />
        ) : (
          <div className={styles.closed}>
            <h3>{b.form.closedHeading}</h3>
            <p>{b.form.closedBody}</p>
            <p>
              <a href={`mailto:${config.contacts.SUPPORT_EMAIL}`}>
                {config.contacts.SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        )}
      </section>

      <section id="what-we-do-with-it" className={styles.section}>
        <p className={styles.eyebrow}>{b.data.eyebrow}</p>
        <h2>{b.data.heading}</h2>
        <ul className={styles.data}>
          {b.data.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          <a href={`/${locale}${b.data.linkPath}`}>{b.data.linkLabel}</a>
        </p>
      </section>

      <section id="the-promise" className={styles.section}>
        <p className={styles.eyebrow}>{b.promise.eyebrow}</p>
        <h2>{b.promise.heading}</h2>
        <p>{b.promise.body}</p>
        <p>
          <a href={`/${locale}${b.promise.linkPath}`}>{b.promise.linkLabel}</a>
        </p>
      </section>
    </article>
  );
}
