import styles from "./route_spine.module.css";

/**
 * The trail the page is hung off. Purely decorative — it carries no text and no link, and
 * the page reads identically with it removed, which is why it is `aria-hidden` and why it is
 * suppressed entirely on narrow screens where the content column has no gutter to spare.
 *
 * The dashed track is always drawn. The solid overlay is drawn *by scrolling*, using a CSS
 * scroll-driven animation with no JavaScript behind it: `animation-timeline` is behind an
 * `@supports` guard in the stylesheet, so a browser without it simply shows the dashed track
 * and nothing looks broken or half-finished.
 *
 * The stroke geometry matches the brand trail — the same dash rhythm as the `#trail` path in
 * brand_mark.tsx, scaled up.
 */
const ROUTE =
  "M32 0 C 6 150, 58 270, 32 410 C 8 545, 56 665, 32 805 C 18 885, 34 945, 32 1000";

export function RouteSpine() {
  return (
    <div className={styles.spine} aria-hidden="true">
      <svg className={styles.svg} viewBox="0 0 64 1000" preserveAspectRatio="none">
        <path className={styles.track} d={ROUTE} />
        <path className={styles.progress} d={ROUTE} />
      </svg>
      {/* eslint-disable-next-line @next/next/no-img-element -- vector, own origin */}
      <img
        className={styles.plane}
        src="/brand/peraplano-logo-static.svg"
        alt=""
        width={22}
        height={22}
      />
    </div>
  );
}
