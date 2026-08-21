import { describe, expect, it } from "vitest";
import { SERVICE_CAPABILITIES } from "../config/capabilities.js";

describe("SERVICE_CAPABILITIES", () => {
  // TRIPWIRE. When any of these flips to true, /privacy and /data-deletion stop being
  // true and this test fails on purpose. Before changing a value here, write:
  //   accounts        -> the real account-deletion route on /data-deletion, plus the
  //                      web deletion link Play's account-deletion policy requires
  //                      (privacy §3.7, 30-day removal commitment)
  //   cloudBackup     -> the recipients section of /privacy naming the backup PIP
  //   serverSideStorage -> everything above, and the ServiceStatusNotice copy
  it("still describes a service that stores nothing", () => {
    expect(SERVICE_CAPABILITIES.accounts).toBe(false);
    expect(SERVICE_CAPABILITIES.cloudBackup).toBe(false);
    expect(SERVICE_CAPABILITIES.serverSideStorage).toBe(false);
  });
});
