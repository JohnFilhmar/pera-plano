import type { ReactNode } from "react";
import styles from "./draft_clause.module.css";

/**
 * A terms clause drafted in-house and published with a visible DRAFT stamp.
 *
 * Spec rule §4.0.2 says legal prose requiring professional judgement is "not written, not
 * approximated, and not silently omitted" — a visible hole instead. This component is that
 * rule honoured a different way, on the owner's decision of 2026-08-21: draft five of the
 * seven, and stamp every one of them so a reader can still tell reviewed prose from
 * unreviewed prose at a glance. What §4.0.2 actually forbids is a non-lawyer's clause
 * passing as a reviewed one; a clause that says DRAFT on its face cannot.
 *
 * `data-draft-clause` is the contract the /terms test counts, so the stamp cannot be
 * dropped from one clause while the others keep it.
 *
 * The heading is an <h2> because `sectionHeadingText` in test_support/html.ts targets that
 * level specifically, and every section heading on every page in this app is an <h2>.
 * Two slots, because two clauses need one each and neither wants the other's position:
 * `lead` renders directly under the stamp (the effective-date clause leads with the date
 * itself, which must sit above the prose explaining it) and `children` renders last (the
 * liability clause hangs a Callout about Philippine jurisdiction beneath its text).
 */
export function DraftClause({
  id,
  mark,
  heading,
  lead,
  paragraphs,
  children,
}: {
  id: string;
  mark: string;
  heading: string;
  lead?: ReactNode;
  paragraphs: readonly string[];
  children?: ReactNode;
}) {
  return (
    <section id={id} data-draft-clause className={styles.clause}>
      <h2>{heading}</h2>
      <p className={styles.mark}>{mark}</p>
      {lead}
      {paragraphs.map((paragraph, index) => (
        <p key={`${id}-p-${String(index)}`}>{paragraph}</p>
      ))}
      {children}
    </section>
  );
}
