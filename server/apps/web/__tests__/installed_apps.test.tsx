import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstalledAppsPage } from "@/components/pages/installed_apps_page.js";
import { getMessages } from "@/messages/index.js";
import { stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const text = () =>
  stripTags(
    renderToStaticMarkup(
      <InstalledAppsPage messages={getMessages("en")} config={COMPLETE_CONFIG} />,
    ),
  );

describe("/installed-apps", () => {
  it("says exactly what is read", () => {
    expect(text()).toContain("package names");
  });

  it("names the permission", () => {
    expect(text()).toContain("QUERY_ALL_PACKAGES");
  });

  // roadmap §0.2: Google's enumerated permitted uses "do not obviously cover" this, and
  // "a rejection is a live possibility". A confident page contradicts our own decision record.
  it("concedes the permitted-use ambiguity rather than claiming coverage", () => {
    const body = text();
    expect(body).toContain("do not obviously cover");
    expect(body.toLowerCase()).not.toContain("google permits this");
    expect(body.toLowerCase()).not.toContain("approved by google");
  });

  it("describes the queries-allowlist fallback and its user-visible cost", () => {
    const body = text();
    expect(body).toContain("<queries>");
    expect(body).toContain("allowlist");
    expect(body).toContain("app update");
  });

  it("lists what is never read", () => {
    const body = text();
    expect(body).toContain("usage");
    expect(body).toContain("never");
  });
});
