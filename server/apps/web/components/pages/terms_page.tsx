import type { AppConfig } from "@peraplano/common";
import { CounselRequiredNotice } from "@/components/content/counsel_required_notice";
import { DataTable } from "@/components/content/data_table";
import { Prose } from "@/components/content/prose";
import type { Messages } from "@/messages/index";
import styles from "./terms_page.module.css";

/**
 * Spec §4.4, and the spec calls this the weakest page in the set. Brief §8 and §9 are a
 * product position, not a contract: they say what the tiers are and what the app refuses
 * to be, and nothing about what a terms document exists to say. Sections 1-5 are real
 * derivations; the sixth is a hole with a label on it, rendered as a visible block per
 * spec rule §4.0.2 so that removing it has to be a conscious act in a diff.
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
      <Prose
        sections={[
          { id: "pricing-not-published", ...s.pricingNotPublished },
          { id: "purchases", ...s.purchases },
        ]}
      />

      {/* Spec §4.0.2 and §4.4 section 6. Seven clauses no non-lawyer should write, named
          instead of approximated. A plausible governing-law clause written here would
          create the appearance of a reviewed document, which is how a document stops ever
          being reviewed. Its presence is asserted by __tests__/terms.test.tsx. */}
      <CounselRequiredNotice messages={messages} />
    </article>
  );
}
