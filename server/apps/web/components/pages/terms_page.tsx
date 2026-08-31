import type { AppConfig } from "@peraplano/common";
import { TERMS_EFFECTIVE_DATE, formatPublicationDate } from "@peraplano/common";
import { Callout } from "@/components/content/callout";
import { CounselRequiredNotice } from "@/components/content/counsel_required_notice";
import { DraftClause } from "@/components/content/draft_clause";
import { DataTable } from "@/components/content/data_table";
import { Prose } from "@/components/content/prose";
import type { Messages } from "@/messages/index";
import styles from "./terms_page.module.css";

/**
 * Spec §4.4, and the spec called this the weakest page in the set. Brief §8 and §9 are a
 * product position, not a contract: they say what the tiers are and what the app refuses
 * to be, and nothing about what a terms document exists to say.
 *
 * The hole the spec left has shrunk. On the owner's decision of 2026-08-21, five of the
 * seven missing clauses are drafted in-house and published stamped DRAFT (see DraftClause
 * for why that is spec rule §4.0.2 honoured rather than broken). The two that remain in
 * CounselRequiredNotice are the two that are not drafting problems at all: governing law
 * needs a registered entity to have a domicile, and the subscription terms need a price.
 * Neither exists, so neither can be written by anyone, lawyer or not.
 *
 * `config` is unused today and is still in the signature on purpose: every page component
 * in this app takes the same pair, and the day a governing-law jurisdiction or a company
 * registration number lands it arrives as a fail-loud field, not as a literal typed here.
 */
export function TermsPage({ messages }: { messages: Messages; config: AppConfig }) {
  const { terms } = messages;
  const s = terms.sections;

  return (
    <article className={styles.page}>
      <h1>{terms.title}</h1>

      <p className={styles.intro}>{terms.intro}</p>

      {/* brief §9 permanent non-goals 1, 2 and 3, stated as disclaimers rather than as
          marketing. §5 step 4 (the Review Queue) and §10 ("the user trusts the number")
          for the derived-ledger section. */}
      <Prose
        sections={[
          { id: "what-peraplano-is", ...s.whatPeraPlanoIs },
          { id: "the-ledger-is-derived", ...s.theLedgerIsDerived },
        ]}
      />

      {/* brief §8's locked matrix, verbatim, eleven rows. The prose beneath carries §8's
          gate-behaviour principle and privacy §8's "privacy controls are never Plus-gated"
          — a commercial commitment as much as a privacy one, so it belongs on both pages.
          It also says the caps are not enforced in the current build, which brief §8 states
          outright; printing the matrix without that would describe a reader as bound by
          gating that does not run yet. */}
      <section id="tiers" className={styles.section}>
        <h2>{s.tiers.heading}</h2>
        <p>{s.tiers.intro}</p>
        <DataTable
          id="tiers"
          caption={s.tiers.caption}
          headers={s.tiers.headers}
          rows={s.tiers.rows}
        />
        {s.tiers.afterTable.map((paragraph, index) => (
          <p key={`tiers-after-${String(index)}`}>{paragraph}</p>
        ))}
      </section>

      {/* brief §8: pricing in pesos is deliberately undecided. No number is invented, and
          the page says a price will appear here before anything can be bought — which is
          also the only honest thing to say while there is no way to buy Plus at all. */}
      {/* Directly after the tier table and before the pricing clause, because it is an
          exception to both: it says who is not charged, and it has to be readable next to
          the thing it is an exception to. The commitment is made here rather than only on
          /beta — a promise about money that lives solely on a recruitment page is a
          marketing line, not a term. */}
      <Prose sections={[{ id: "beta-testers", ...s.betaTesters }]} />

      <Prose
        sections={[
          { id: "pricing-not-published", ...s.pricingNotPublished },
          { id: "purchases", ...s.purchases },
        ]}
      />

      {/* The five in-house drafts. Order is the order a reader needs them in: what you are
          licensed to do, how it ends, what is not warranted when it goes wrong, how the
          document itself changes, and from when. Each carries the same DRAFT stamp from a
          single catalog string, so no clause can quietly lose it. */}

      {/* brief §9 non-goal 3 (the business model is the subscription, never the data) is
          what makes the third paragraph a commitment rather than a nicety: the licence has
          to be explicit that the company takes no rights over the user's ledger, because
          the whole product rests on that being true. */}
      <DraftClause
        id="intellectual-property"
        mark={terms.draftMark}
        heading={s.intellectualProperty.heading}
        paragraphs={s.intellectualProperty.paragraphs}
      />

      {/* Written against SERVICE_CAPABILITIES rather than against today's build: the last
          paragraph says what changes if a sign-in identity ever lands, so Firebase auth
          arriving does not falsify this clause — it triggers the revision the clause itself
          already promises, next to the Play account-deletion route privacy §3.7 requires. */}
      <DraftClause
        id="termination-and-suspension"
        mark={terms.draftMark}
        heading={s.terminationAndSuspension.heading}
        paragraphs={s.terminationAndSuspension.paragraphs}
      />

      {/* The failure modes are lifted from theLedgerIsDerived above, deliberately: a
          warranty disclaimer grounded in this product's actual parse failures is worth more
          than a generic one, and it cannot drift from what the page already admits.

          The Callout is not decoration. Liability caps are the one clause here where a
          confident-sounding draft is actively dangerous — Civil Code arts. 1170-1174 and the
          Consumer Act constrain what may be disclaimed to a Philippine consumer, and a
          US-shaped cap can be void. So the draft states the shape and no number, and says
          out loud that counsel sets the limits. */}
      <DraftClause
        id="limitation-of-liability"
        mark={terms.draftMark}
        heading={s.limitationOfLiability.heading}
        paragraphs={s.limitationOfLiability.paragraphs}
      >
        <Callout tone="warn" heading={s.limitationOfLiability.jurisdictionHeading}>
          <p>{s.limitationOfLiability.jurisdictionNote}</p>
        </Callout>
      </DraftClause>

      <DraftClause
        id="changes-to-these-terms"
        mark={terms.draftMark}
        heading={s.changesToTheseTerms.heading}
        paragraphs={s.changesToTheseTerms.paragraphs}
      />

      {/* The date is imported, never typed. A date living in a catalog sentence rots in
          total silence: the terms change, the sentence does not, and no test anywhere
          fails. TERMS_EFFECTIVE_DATE is the single edit that moves it, and the /terms test
          derives its expectation from the same constant so the two cannot disagree.
          <time datetime> because a machine-readable publication date on a legal page is
          worth the four extra characters. */}
      <DraftClause
        id="effective-date"
        mark={terms.draftMark}
        heading={s.effectiveDate.heading}
        lead={
          <p className={styles.effective}>
            {s.effectiveDate.label}{" "}
            <time dateTime={TERMS_EFFECTIVE_DATE}>
              {formatPublicationDate(TERMS_EFFECTIVE_DATE)}
            </time>
            .
          </p>
        }
        paragraphs={s.effectiveDate.paragraphs}
      />

      {/* Spec §4.0.2 and §4.4 section 6, now down to two clauses. Both are blocked on a
          decision that does not exist rather than on drafting effort, which is why they are
          named instead of approximated: a plausible governing-law clause written here would
          create the appearance of a reviewed document, and that is how a document stops
          ever being reviewed. Its presence is asserted by __tests__/terms.test.tsx. */}
      <CounselRequiredNotice messages={messages} />
    </article>
  );
}
