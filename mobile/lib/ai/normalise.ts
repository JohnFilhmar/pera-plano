// mobile/lib/ai/normalise.ts
//
// ONE NORMALISATION FOR EVERY TABLE THAT READS TYPED TEXT. Triage's advice
// rows, the small-talk rows, the level-2 question rows and the level-5 money
// words all match against it, so a phrasing reads the same way to all four.
// Moved out of `triage.ts` when a second module needed it.

/**
 * Lowercases, drops punctuation and collapses whitespace.
 *
 * Punctuation goes because "Should I... buy this?!" is the same question as
 * "should i buy this", and a table that only matched the tidy form would be
 * evaded by anyone typing normally. The hyphen survives, because "makaka-ipon"
 * and "mag-ipon" are spelled with one. The peso sign does not survive, which is
 * why `mentionsMoney` looks for it before normalising.
 *
 * @param input - Text as typed.
 * @returns The normalised text; empty when the input held only punctuation or space.
 */
export function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
