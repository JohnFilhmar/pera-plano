/**
 * Facts the public pages print that are neither copy nor configuration.
 *
 * Copy lives in `apps/web/messages/en.json`. Legal identifiers that nobody may invent
 * live in the environment and fail loud (`config/env.ts`). These two are the third kind:
 * values that are known, stable, and must be machine-readable rather than typed into a
 * sentence — so they sit here, where a test can pin them.
 */

/**
 * The date these terms take effect, ISO-8601, rendered into `<time datetime="…">`.
 *
 * Deliberately a constant and not prose. A date written into a paragraph in the catalog
 * rots in total silence: the terms change, the sentence does not, and nothing anywhere
 * fails. Bumping this constant is the one edit that moves the published date, and the
 * /terms test derives its expectation from it rather than from a literal — so the two
 * cannot disagree.
 */
export const TERMS_EFFECTIVE_DATE = "2026-08-21";

/**
 * The owner's other work, linked once from the marketing page.
 *
 * This is the APEX domain — a different site from this one, which is served from the
 * `peraplano.` subdomain so it can never shadow the apex (design spec, global constraint 3).
 *
 * It lives in `libs/common` rather than in the marketing component for a specific reason:
 * `apps/web/{app,components,messages}` is under a blanket ban on the `filhmar.online`
 * literal (`apps/web/__tests__/structure.test.ts`), because a hostname literal in a page
 * silently beats `PUBLIC_BASE_URL` on a staging deploy. The ban is worth more as a blanket
 * than as a rule with an exception list, so the one legitimate use imports a constant from
 * the same package that already owns `DEFAULT_PUBLIC_BASE_URL`.
 */
export const OWNER_SITE_URL = "https://filhmar.online";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * `2026-08-21` → `21 August 2026`.
 *
 * Hand-rolled rather than `toLocaleDateString` or `new Date(iso)` on purpose. `new Date`
 * on a bare `YYYY-MM-DD` parses as UTC midnight and then renders in the host's timezone,
 * so a container east of UTC prints the previous day — a legal page publishing a date
 * that is off by one depending on where the server sits is exactly the class of quiet
 * wrongness this site exists to avoid. Throws rather than returning "Invalid Date": a
 * visible crash beats a legal page confidently displaying nonsense.
 */
export function formatPublicationDate(iso: string): string {
  // Sliced rather than destructured out of the match, because `noUncheckedIndexedAccess`
  // makes every capture-group index `string | undefined` and the casts needed to unwrap
  // them are noisier than reading fixed offsets out of a string whose shape was just proved.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`formatPublicationDate: not an ISO-8601 calendar date: ${JSON.stringify(iso)}`);
  }
  const year = iso.slice(0, 4);
  const monthName = MONTHS[Number(iso.slice(5, 7)) - 1];
  if (monthName === undefined) {
    throw new Error(`formatPublicationDate: month out of range in ${iso}`);
  }
  const day = Number(iso.slice(8, 10));
  if (day < 1 || day > 31) {
    throw new Error(`formatPublicationDate: day out of range in ${iso}`);
  }
  return `${String(day)} ${monthName} ${year}`;
}
