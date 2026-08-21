import type { AppConfig } from "@peraplano/common";
import { BrandMark } from "@/components/content/brand_mark";
import type { Locale, Messages } from "@/messages/index";
import styles from "./marketing_page.module.css";

/**
 * Spec §4.1. Sources: brief §1 (vision), §2 (the promise, verbatim), §3 (why the
 * Philippines), §4 (three personas), §5 (how it works), §7 (voice), §9 (non-goals) and
 * privacy §1 (the local-first stance).
 *
 * Two deliberate absences. There is no Play badge: `marketing.hero.storeBadge` is null
 * because no listing exists, and a badge linking to `#` on a page a reviewer might read is
 * worse than no badge — adding it later is a value change, not a code change. And there is
 * no price: brief §8 leaves pricing undecided, so the tier comparison lives on /terms with
 * the other commercial representations and this page links to it.
 *
 * §3 is rendered although the owner's per-page source list does not name it (recorded as
 * pre-flight Ruling 7): §4's personas are unintelligible to a non-PH reader — a Play
 * reviewer included — without the six facts underneath them.
 */
export function MarketingPage({
  messages,
  locale,
}: {
  messages: Messages;
  config: AppConfig;
  locale: Locale;
}) {
  const { marketing } = messages;
  const m = marketing;

  return (
    <article className={styles.page}>
      {/* brief §2's positioning statement, verbatim, as the first thing on the site. */}
      <header className={styles.hero}>
        <BrandMark size={56} />
        <p className={styles.eyebrow}>{m.hero.eyebrow}</p>
        <h1>{m.hero.tagline}</h1>
        <p className={styles.lede}>{m.hero.lede}</p>
        <p className={styles.heroSub}>{m.hero.sub}</p>
        {/* Renders nothing today by design; see the storeBadge note in the catalog. */}
        {m.hero.storeBadge === null ? (
          <p className={styles.badgeNote}>{m.hero.storeBadgeNote}</p>
        ) : null}
      </header>

      {/* brief §5's five steps, condensed to their verbs. */}
      <section id="how-it-works" className={styles.section}>
        <h2>{m.whatItDoes.heading}</h2>
        <p>{m.whatItDoes.intro}</p>
        <ol className={styles.steps}>
          {m.whatItDoes.steps.map((step) => (
            <li key={step.verb} className={styles.step}>
              <h3>{step.verb}</h3>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>

        {/* brief §5 flags its own sample as invented, and so does this. The disclaimer is
            rendered ABOVE the sample, not under it, because a reader who stops after the
            quote must have already been told it is not a real bank message. The
            data-illustrative marker is what the marketing test uses to scope its
            no-price ban to everything except this block. */}
        <figure data-illustrative className={styles.example}>
          <figcaption className={styles.exampleHead}>
            <strong>{m.whatItDoes.exampleHeading}</strong>
            <span className={styles.disclaimer}>{m.whatItDoes.exampleDisclaimer}</span>
          </figcaption>
          <blockquote className={styles.exampleQuote}>
            {m.whatItDoes.exampleNotification}
          </blockquote>
          <p className={styles.exampleResult}>{m.whatItDoes.exampleResult}</p>
        </figure>
      </section>

      {/* brief §4's three personas. */}
      <section id="who-it-is-for" className={styles.section}>
        <h2>{m.whoItIsFor.heading}</h2>
        <p>{m.whoItIsFor.intro}</p>
        <div className={styles.personas}>
          {m.whoItIsFor.personas.map((persona) => (
            <div key={persona.name} className={styles.persona}>
              <h3>{persona.name}</h3>
              <p>{persona.summary}</p>
              <p className={styles.personaPain}>{persona.pain}</p>
              <p>{persona.gives}</p>
            </div>
          ))}
        </div>

        {/* brief §7's voice rule: Filipino terms are defined on first use on any surface a
            newcomer might land on, and this is the surface every newcomer lands on. */}
        <h3>{m.whoItIsFor.glossaryHeading}</h3>
        <ul className={styles.glossary}>
          {m.whoItIsFor.glossary.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </section>

      {/* brief §3 — see the file-level note on why this section is here at all. */}
      <section id="why-the-philippines" className={styles.section}>
        <h2>{m.whyThePhilippines.heading}</h2>
        <p>{m.whyThePhilippines.intro}</p>
        <ul className={styles.facts}>
          {m.whyThePhilippines.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      {/* brief §9's permanent non-goals, short. Leading with the limits is brand voice and
          the honest frame for a finance app; the full list is on /terms. */}
      <section id="what-it-is-not" className={styles.section}>
        <h2>{m.whatItIsNot.heading}</h2>
        <p>{m.whatItIsNot.intro}</p>
        <ul>
          {m.whatItIsNot.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <p>
          <a href={`/${locale}${m.whatItIsNot.linkPath}`}>{m.whatItIsNot.linkLabel}</a>
        </p>
      </section>

      {/* privacy §1 — the local-first stance, three sentences, linking to the full notice. */}
      <section id="privacy-promise" className={styles.section}>
        <h2>{m.privacyPromise.heading}</h2>
        {m.privacyPromise.paragraphs.map((paragraph, index) => (
          <p key={`privacy-promise-${String(index)}`}>{paragraph}</p>
        ))}
        <p>
          <a href={`/${locale}${m.privacyPromise.linkPath}`}>{m.privacyPromise.linkLabel}</a>
        </p>
      </section>

      {/* Spec §4.1 section 7: a "free tier" claim is a commercial representation and belongs
          with the others. This is a pointer, not a restatement. */}
      <section id="tiers" className={styles.section}>
        <h2>{m.tiersLink.heading}</h2>
        <p>{m.tiersLink.body}</p>
        <p>
          <a href={`/${locale}${m.tiersLink.linkPath}`}>{m.tiersLink.linkLabel}</a>
        </p>
      </section>
    </article>
  );
}
