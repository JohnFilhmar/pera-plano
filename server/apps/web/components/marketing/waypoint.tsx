import type { ReactNode } from "react";
import { NavGlyph, type NavDirection } from "./nav_glyph";
import styles from "./waypoint.module.css";

/**
 * One stop on the route. Every section of the marketing page is one of these, and the shape
 * is the whole argument of the revamp: eyebrow, heading, ONE line, evidence, and then a
 * disclosure holding the long-form prose that used to be the page.
 *
 * The disclosure is a plain <details>, not a JavaScript accordion, for three reasons that
 * all matter here: it renders its content into the server HTML, so a Play reviewer reading
 * source and the vitest content assertions both still find every sentence; browser
 * find-in-page opens it; and it costs no bundle.
 *
 * The numbering is real. These are waypoints on a route in the order a reader travels them,
 * which is the one case where 01/02/03 encodes something rather than decorating.
 */
export function Waypoint({
  id,
  index,
  eyebrow,
  heading,
  lede,
  direction,
  disclosureLabel,
  disclosure,
  children,
}: {
  id: string;
  index: string;
  eyebrow: string;
  heading: string;
  lede: string;
  direction: NavDirection;
  disclosureLabel?: string;
  disclosure?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.waypoint}>
      <div className={styles.marker} aria-hidden="true">
        <NavGlyph direction={direction} size={30} />
      </div>

      <header className={styles.head} data-reveal>
        <p className={styles.eyebrow}>
          <span className={`${styles.index} tabular`}>{index}</span>
          {eyebrow}
        </p>
        <h2>{heading}</h2>
        <p className={styles.lede}>{lede}</p>
      </header>

      <div className={styles.body}>{children}</div>

      {disclosure !== undefined && disclosureLabel !== undefined ? (
        <details className={styles.disclosure}>
          <summary>{disclosureLabel}</summary>
          <div className={styles.disclosureBody}>{disclosure}</div>
        </details>
      ) : null}
    </section>
  );
}
