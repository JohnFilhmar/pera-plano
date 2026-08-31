import { describe, expect, it } from "vitest";
import { SERVICE_CAPABILITIES } from "../config/capabilities.js";

describe("SERVICE_CAPABILITIES", () => {
  // TRIPWIRE. When any of these flips, /privacy and /data-deletion stop being true and this
  // test fails on purpose. Before changing a value here, write:
  //   accounts        -> the real account-deletion route on /data-deletion, plus the
  //                      web deletion link Play's account-deletion policy requires
  //                      (privacy §3.7, 30-day removal commitment)
  //   cloudBackup     -> the recipients section of /privacy naming the backup PIP
  //   serverSideStorage -> everything above, and the ServiceStatusNotice copy
  //   betaWaitlist    -> the privacy notice's beta programme section, row 9 of the
  //                      lifecycle table in BOTH docs/07-privacy-and-compliance.md §4 and
  //                      the catalog (privacy_drift.test.tsx compares them verbatim), the
  //                      removal route on /data-deletion, and the ServiceStatusNotice
  //                      exception paragraph
  it("still stores no ledger data on a server", () => {
    expect(SERVICE_CAPABILITIES.accounts).toBe(false);
    expect(SERVICE_CAPABILITIES.cloudBackup).toBe(false);
    expect(SERVICE_CAPABILITIES.serverSideStorage).toBe(false);
  });

  // Flipped on 2026-08-31 with the /beta page. This assertion is not a formality: it is the
  // thing that fails if someone deletes the beta page and leaves the privacy notice
  // describing a list that no longer exists. Turning it back to false means removing the
  // section, row 9 and the deletion route in the same change.
  it("records that the beta signup list exists, so the notice describing it cannot go stale", () => {
    expect(SERVICE_CAPABILITIES.betaWaitlist).toBe(true);
  });
});
