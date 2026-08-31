/**
 * The eight-direction pagination set from `assets/brand/nav/`, which shipped with the brand
 * delivery and then drove nothing for a year — `docs/14-design-revamp-prompt.md` §6.3 asks
 * for a decision, "use it or cut it". This is the use: each waypoint marker points in the
 * direction the route is travelling at that node, and the document pages reuse the set as a
 * previous/next pager.
 *
 * Rendered through <img> deliberately. Every file in that set is SMIL-animated, and a
 * browser plays SMIL inside an <img> natively — inlining them would mean hand-porting eight
 * animations to CSS for no gain. (The phone cannot do this at all; react-native-svg drops
 * SMIL silently, which is why the set was never ported. See assets/brand/README.md.)
 */
export type NavDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export function NavGlyph({
  direction,
  size = 26,
  className,
}: {
  direction: NavDirection;
  size?: number;
  className?: string;
}) {
  return (
    // next/image would rasterise these and strip the SMIL timeline with it; they are 1-2 KB
    // vector files served from our own origin, so there is nothing for it to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/brand/nav/nav-${direction}.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
