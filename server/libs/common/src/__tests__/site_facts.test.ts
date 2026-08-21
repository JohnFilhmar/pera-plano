import { describe, expect, it } from "vitest";
import {
  OWNER_SITE_URL,
  TERMS_EFFECTIVE_DATE,
  formatPublicationDate,
} from "../content/site_facts.js";

describe("terms effective date", () => {
  // The date is rendered into <time datetime="…"> on /terms. Prose rots silently; a
  // machine-readable constant that a test can reformat does not.
  it("is an ISO-8601 calendar date", () => {
    expect(TERMS_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats to a written date without depending on the host locale or timezone", () => {
    expect(formatPublicationDate("2026-08-21")).toBe("21 August 2026");
    expect(formatPublicationDate("2026-01-01")).toBe("1 January 2026");
    expect(formatPublicationDate("2026-12-31")).toBe("31 December 2026");
  });

  // A silently wrong date on a legal page is worse than a crash on one.
  it("refuses a malformed or impossible date rather than printing nonsense", () => {
    expect(() => formatPublicationDate("21-08-2026")).toThrow(/ISO-8601/);
    expect(() => formatPublicationDate("2026-13-01")).toThrow(/month/);
    expect(() => formatPublicationDate("")).toThrow(/ISO-8601/);
  });
});

describe("owner site link", () => {
  // apps/web/{app,components,messages} is under a blanket "filhmar.online" ban
  // (apps/web/__tests__/structure.test.ts) that exists so no literal can beat
  // PUBLIC_BASE_URL on a staging deploy. This is the owner's OTHER site, not this
  // site's host, and it lives here beside DEFAULT_PUBLIC_BASE_URL so the ban stays blanket.
  it("is the apex, not this site's own subdomain", () => {
    expect(OWNER_SITE_URL).toBe("https://filhmar.online");
  });
});
