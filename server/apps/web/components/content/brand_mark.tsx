/**
 * Hand-written rather than an <img>: assets/brand/peraplano-logo-animated.svg ships with
 * no animation, only the stable ids #plane and #trail for the web front end's CSS to
 * drive. An <img> puts those ids in a separate document our stylesheet cannot reach.
 * Geometry is copied verbatim from that file; brand hexes come from assets/brand/README.md.
 */
export function BrandMark({ size = 26, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="PeraPlano"
      className={animated ? "brand-mark--animated" : undefined}
    >
      <path
        id="trail"
        d="M2.6 21.4 C 6 21 8.6 18.4 10.2 14.2"
        fill="none"
        stroke="var(--brand-2)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="0.12 2.1"
        opacity="0.55"
      />
      <g id="plane">
        <path d="M22 2 L2 9 L11 13 Z" fill="var(--brand-2)" />
        <path d="M22 2 L11 13 L15 22 Z" fill="var(--brand)" />
      </g>
    </svg>
  );
}
