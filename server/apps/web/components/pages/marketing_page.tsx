import type { AppConfig } from "@peraplano/common";
import { OWNER_SITE_URL } from "@peraplano/common";
import { UnfilledRolesNotice } from "@/components/content/unfilled_roles_notice";
import { BoundaryDiagram } from "@/components/marketing/boundary_diagram";
import { CaptureDemo } from "@/components/marketing/capture_demo";
import { HeroField } from "@/components/marketing/hero_field";
import { RevealRoot } from "@/components/marketing/reveal_root";
import { RouteSpine } from "@/components/marketing/route_spine";
import { Waypoint } from "@/components/marketing/waypoint";
import type { Locale, Messages } from "@/messages/index";
import styles from "./marketing_page.module.css";

/**
 * Spec §4.1 and docs/superpowers/specs/2026-08-31-web-front-facing-revamp-design.md.
 * Sources unchanged: brief §1 (vision), §2 (the promise, verbatim), §3 (why the
 * Philippines), §4 (three personas), §5 (how it works), §7 (voice), §9 (non-goals) and
 * privacy §1 (the local-first stance).
 *
 * WHAT CHANGED, AND WHY IT IS SAFE. This page used to render every one of those sources as
 * prose, about 1,170 words of it, and read as a document rather than as the front of a
 * product whose premise is that you do not type. The revamp keeps every sentence and moves
 * the long form into a <details> per section. That is not a cosmetic distinction: <details>
 * content is in the server HTML, so the vitest content contract, a Play reviewer reading
 * source, and find-in-page all still reach it, while a human reads roughly a third as much.
 *
 * THE ONE RULE A FUTURE EDIT WILL BREAK. Every peso figure on this page must stay inside
 * CaptureDemo's single <figure data-illustrative>. marketing.test.tsx removes one non-greedy
 * figure match and then bans currency digits from everything that is left, because brief §8
 * leaves pricing undecided. Rendering an amount anywhere else — a second figure, a pull
 * quote, a stat chip — fails that test by design.
 *
 * Two deliberate absences carry over. There is no Play badge: `marketing.hero.storeBadge` is
 * null because no listing exists, and a badge linking to `#` on a page a reviewer might read
 * is worse than no badge. And there is no price; the tier comparison lives on /terms with
 * the other commercial representations, and this page points at it.
 *
 * §3 is rendered although the owner's per-page source list does not name it (pre-flight
 * Ruling 7): §4's personas are unintelligible to a non-PH reader — a Play reviewer included
 * — without the six facts underneath them.
 */
export function MarketingPage({
  messages,
  config,
  locale,
}: {
  messages: Messages;
  config: AppConfig;
  locale: Locale;
}) {
  const m = messages.marketing;

  return (
    <article className={styles.page}>
      <RevealRoot />

      {/* brief §2's positioning statement, verbatim, as the first thing on the site — now
          with the thing it describes running underneath it. */}
      <header className={styles.hero}>
        <HeroField />
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            {/* eslint-disable-next-line @next/next/no-img-element -- vector, own origin */}
            <img
              className={styles.heroMark}
              src="/brand/peraplano-logo-layered.svg"
              alt=""
              aria-hidden="true"
              width={44}
              height={44}
            />
            <p className={styles.eyebrow}>{m.hero.eyebrow}</p>
            <h1 className={styles.tagline}>{m.hero.tagline}</h1>
            <p className={styles.lede}>{m.hero.lede}</p>
            <p className={styles.heroSub}>{m.hero.sub}</p>
            <a className={styles.scrollCue} href={m.hero.scrollCueTarget}>
              {m.hero.scrollCue}
            </a>
            {/* Renders nothing today by design; see the storeBadge note in the catalog. It
                is a sentence, not a button, because dressing up the explanation for a
                missing download would suggest something is clickable. */}
            {m.hero.storeBadge === null ? (
              <p className={styles.badgeNote}>{m.hero.storeBadgeNote}</p>
            ) : null}
          </div>

          <div className={styles.heroDemo}>
            <CaptureDemo demo={m.demo} />
          </div>
        </div>
      </header>

      <div className={styles.route}>
        <RouteSpine />

        {/* brief §5's five steps, condensed to their verbs. */}
        <Waypoint
          id="how-it-works"
          index="01"
          eyebrow={m.howItWorks.eyebrow}
          heading={m.howItWorks.heading}
          lede={m.howItWorks.lede}
          direction="se"
          disclosureLabel={m.howItWorks.disclosureLabel}
          disclosure={
            <ul>
              {m.howItWorks.beats.map((beat) => (
                <li key={beat.verb}>
                  <strong>{beat.verb}.</strong> {beat.long}
                </li>
              ))}
            </ul>
          }
        >
          <ol className={styles.beats}>
            {m.howItWorks.beats.map((beat, index) => (
              <li
                key={beat.verb}
                className={styles.beat}
                data-reveal
                style={{ "--reveal-delay": `${index * 70}ms` } as React.CSSProperties}
              >
                <span className={`${styles.beatIndex} tabular`}>{index + 1}</span>
                <h3>{beat.verb}</h3>
                <p>{beat.line}</p>
              </li>
            ))}
          </ol>
        </Waypoint>

        {/* brief §4's three personas. brief §7's voice rule says Filipino terms are defined
            on first use on any surface a newcomer might land on; the definitions are now
            attached to the persona that needs them rather than piled into a glossary the
            reader meets after the words. */}
        <Waypoint
          id="who-it-is-for"
          index="02"
          eyebrow={m.whoItIsFor.eyebrow}
          heading={m.whoItIsFor.heading}
          lede={m.whoItIsFor.lede}
          direction="e"
          disclosureLabel={m.whoItIsFor.disclosureLabel}
          disclosure={
            <ul>
              {m.whoItIsFor.personas.map((persona) => (
                <li key={persona.name}>
                  <strong>{persona.name}.</strong> {persona.long}
                </li>
              ))}
            </ul>
          }
        >
          <div className={styles.personas}>
            {m.whoItIsFor.personas.map((persona, index) => (
              <div
                key={persona.name}
                className={styles.persona}
                data-reveal
                style={{ "--reveal-delay": `${index * 90}ms` } as React.CSSProperties}
              >
                <h3>{persona.name}</h3>
                <p className={styles.personaDefinition}>{persona.definition}</p>
                <p className={styles.personaPain}>{persona.pain}</p>
                <p className={styles.personaGives}>{persona.gives}</p>
              </div>
            ))}
          </div>
        </Waypoint>

        {/* brief §3 — see the file-level note on why this section is here at all. */}
        <Waypoint
          id="why-the-philippines"
          index="03"
          eyebrow={m.whyThePhilippines.eyebrow}
          heading={m.whyThePhilippines.heading}
          lede={m.whyThePhilippines.lede}
          direction="ne"
          disclosureLabel={m.whyThePhilippines.disclosureLabel}
          disclosure={
            <ul>
              {m.whyThePhilippines.facts.map((fact) => (
                <li key={fact.stat}>{fact.long}</li>
              ))}
            </ul>
          }
        >
          <ul className={styles.facts}>
            {m.whyThePhilippines.facts.map((fact, index) => (
              <li
                key={fact.stat}
                className={styles.fact}
                data-reveal
                style={{ "--reveal-delay": `${index * 60}ms` } as React.CSSProperties}
              >
                <strong>{fact.stat}</strong> {fact.line}
              </li>
            ))}
          </ul>
        </Waypoint>

        {/* privacy §1 — the local-first stance. */}
        <Waypoint
          id="privacy-promise"
          index="04"
          eyebrow={m.privacyPromise.eyebrow}
          heading={m.privacyPromise.heading}
          lede={m.privacyPromise.lede}
          direction="n"
          disclosureLabel={m.privacyPromise.disclosureLabel}
          disclosure={
            <>
              {m.privacyPromise.paragraphs.map((paragraph, index) => (
                <p key={`privacy-promise-${String(index)}`}>{paragraph}</p>
              ))}
            </>
          }
        >
          <BoundaryDiagram points={m.privacyPromise.points} />
          <p className={styles.waypointLink}>
            <a href={`/${locale}${m.privacyPromise.linkPath}`}>{m.privacyPromise.linkLabel}</a>
          </p>
        </Waypoint>

        {/* Owner's ruling, 2026-08-21. It follows the privacy promise deliberately: the
            promise above is what the architecture delivers, and this is what the organisation
            around it does not yet. Leaving the second half out would make the first half a
            claim rather than a description. It is also the one block on the page with no
            reveal, no marker and no styling of its own — an admission that has been designed
            is an admission that is being sold. */}
        <div className={styles.admission}>
          <UnfilledRolesNotice messages={messages} config={config} />
        </div>

        {/* brief §9's permanent non-goals, short. Leading with the limits is brand voice and
            the honest frame for a finance app; the full list is on /terms. */}
        <Waypoint
          id="what-it-is-not"
          index="05"
          eyebrow={m.whatItIsNot.eyebrow}
          heading={m.whatItIsNot.heading}
          lede={m.whatItIsNot.intro}
          direction="s"
        >
          <ul className={styles.limits}>
            {m.whatItIsNot.bullets.map((bullet, index) => (
              <li
                key={bullet}
                data-reveal
                style={{ "--reveal-delay": `${index * 55}ms` } as React.CSSProperties}
              >
                {bullet}
              </li>
            ))}
          </ul>
          <p className={styles.waypointLink}>
            <a href={`/${locale}${m.whatItIsNot.linkPath}`}>{m.whatItIsNot.linkLabel}</a>
          </p>
        </Waypoint>
      </div>

      <footer className={styles.closing}>
        {/* Spec §4.1 section 7: a "free tier" claim is a commercial representation and
            belongs with the others. This is a pointer, not a restatement. */}
        <section id="tiers" className={styles.closingCard}>
          <h2>{m.tiersLink.heading}</h2>
          <p>{m.tiersLink.body}</p>
          <a href={`/${locale}${m.tiersLink.linkPath}`}>{m.tiersLink.linkLabel}</a>
        </section>

        {/* The one external link on the site. The href comes from OWNER_SITE_URL in
            libs/common rather than from the catalog, because apps/web/{app,components,
            messages} is under a blanket ban on this project's own hostname literal — a
            hostname in a page silently beats PUBLIC_BASE_URL on a staging deploy, and the ban
            is worth more as a blanket than as a rule with an exception list, so the one
            legitimate link imports the constant. Note the constant is the APEX domain; this
            site is served from a subdomain of it, so it cannot shadow it. */}
        <section id="built-alongside" className={styles.closingCard}>
          <h2>{m.builtAlongside.heading}</h2>
          <p>{m.builtAlongside.body}</p>
          <a href={OWNER_SITE_URL}>{m.builtAlongside.linkLabel}</a>
        </section>
      </footer>
    </article>
  );
}
