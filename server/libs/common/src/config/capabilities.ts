/**
 * What this platform actually does today. /privacy and /data-deletion both claim
 * "nothing is stored on our servers"; this constant is the one place that claim is
 * stated, so the two pages cannot drift apart. Flipping any flag fails the tripwire
 * test in __tests__/capabilities.test.ts, which lists what must be written first.
 */
export const SERVICE_CAPABILITIES = {
  accounts: false,
  cloudBackup: false,
  serverSideStorage: false,
  /**
   * The beta tester signup list, added 2026-08-31. Deliberately its own flag rather than
   * folded into serverSideStorage, because the two say different things and collapsing them
   * would make one of the pages lie.
   *
   * `serverSideStorage` is about the LEDGER: transactions, wallets, rules, raw notification
   * text. That is still false and the claim on /privacy and /data-deletion still holds — no
   * financial data leaves the phone.
   *
   * `betaWaitlist` is about a recruitment list: an email address a person typed into a form
   * on /beta so we can invite them to a Play closed test. It is personal data on a server,
   * it is the first of its kind in this project, and it is why /privacy now carries a beta
   * programme section and a row 9 in the lifecycle table.
   */
  betaWaitlist: true,
} as const;
