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
} as const;
