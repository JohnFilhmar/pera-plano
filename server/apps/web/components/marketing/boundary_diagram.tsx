import styles from "./boundary_diagram.module.css";

/**
 * The privacy waypoint's evidence. A phone outline with the ledger inside it and a dashed
 * edge nothing crosses — the point being that there is no arrow leaving the device, because
 * there is nowhere for one to go.
 *
 * Deliberately not a lock, a shield or a padlock badge. Those are the icons of a service
 * promising to guard data it holds; this app does not hold anything, and borrowing that
 * vocabulary would describe the wrong architecture.
 *
 * The mark inside is `peraplano-idle-logo.svg`, SMIL-animated in the browser and, until this
 * page, unused on the web.
 */
export function BoundaryDiagram({ points }: { points: readonly string[] }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.device} data-reveal>
        <span className={styles.notch} aria-hidden="true" />
        <div className={styles.screen}>
          {/* eslint-disable-next-line @next/next/no-img-element -- SMIL, see nav_glyph */}
          <img
            className={styles.mark}
            src="/brand/peraplano-idle-logo.svg"
            alt=""
            aria-hidden="true"
            width={54}
            height={54}
          />
          <span className={styles.row} aria-hidden="true" />
          <span className={styles.row} data-short aria-hidden="true" />
          <span className={styles.row} aria-hidden="true" />
        </div>
      </div>

      <ul className={styles.points}>
        {points.map((point, index) => (
          <li key={point} data-reveal style={{ "--reveal-delay": `${index * 90}ms` } as React.CSSProperties}>
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}
