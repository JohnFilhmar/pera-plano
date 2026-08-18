// components/onboarding/value_panels.ts — task-3-brief.md.
//
// The four scenes `ValueCarousel` (value_carousel.tsx) renders through
// `ImagePlaceholder` (Task 2). Each `brief` below is the deliverable of
// this file, not scaffolding around one: it is product-owner-approved
// prose, transcribed verbatim from the brief so it can be handed to a
// photographer or image model as-is. Do not paraphrase, shorten, or
// "improve" a brief when touching this file.
//
// ART DIRECTION (stated once here so it travels with the briefs):
//   - Filipino subjects, Philippine settings. Not re-dressed American stock.
//   - Warm natural light, candid framing, real phones held the way people
//     hold them.
//   - Brand green #22C55E appears as an accent — app UI, signage, a plant
//     — never as a wash over the whole frame.
//   - Panels 3 and 4 (already_logged, whats_left) embed app UI, so each
//     needs a light AND a dark rendition once real photography or renders
//     replace this placeholder.
//
// NO REAL BRANDS, ANYWHERE IN THE FINAL ART. The cafe, the card, and the
// bank in "the_notification" are all fictional. Two independent reasons,
// both binding:
//   1. Trademark exposure in shipped marketing art.
//   2. This codebase's existing rule that no invented string is presented
//      as a real provider format (docs rule 15). how_it_works.tsx's own
//      header cites that same rule, and the sample notification `Card` it
//      renders just below this carousel is labelled "illustrative only,
//      not a real notification" for exactly this reason. A photo of a real
//      bank's real notification here would break the discipline that
//      screen already keeps.
export type ValuePanel = {
  /** Stable key, snake_case. */
  id: string;
  label: string;
  /** The art brief handed to the photographer / image model. */
  brief: string;
};

export const VALUE_PANELS: readonly ValuePanel[] = [
  {
    id: "the_tap",
    label: "The tap",
    brief:
      "Young Filipino professional at a coffee-shop counter in a Manila mall, tapping a debit " +
      "card on the POS terminal, barista mid-hand-off. Warm late-afternoon light, candid not " +
      "posed. Their phone is still in their pocket — no app, no screen, nothing to do. This " +
      "is the moment before PeraPlano does anything.",
  },
  {
    id: "the_notification",
    label: "The notification",
    brief:
      "The same person walking to a table, phone now in hand, lock screen showing a single " +
      "bank notification banner about a card purchase. PeraPlano is NOT open. Slight motion " +
      "blur behind them. The notification is the raw material — it already arrives on every " +
      "phone, whether or not anyone reads it.",
  },
  {
    id: "already_logged",
    label: "Already logged",
    brief:
      "Seated, coffee on the table, PeraPlano open. The transaction is already there as a " +
      "filled ledger row: merchant, amount in pesos, a wallet chip, a category chip, a " +
      "timestamp. Their thumb hovers over the screen without typing. Nothing was entered by " +
      "hand. This is the panel that has to sell the product.",
  },
  {
    id: "whats_left",
    label: "What's left",
    brief:
      "Close-up of the phone on PeraPlano's Home tab: the Safe-to-Spend figure large and " +
      "green, the weekly limit ring part-filled, the next-payday chip below it. Their " +
      "shoulders relaxed in soft background bokeh. Capture is the mechanism; knowing what is " +
      "safe to spend is the reason. End on control, not surveillance.",
  },
];
