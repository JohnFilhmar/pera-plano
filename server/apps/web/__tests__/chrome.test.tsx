import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/chrome/site_footer.js";
import { SiteHeader } from "@/components/chrome/site_header.js";
import { getMessages } from "@/messages/index.js";
import { COMPLETE_CONTACTS, HOLLOW_CONTACTS } from "@/test_support/env_fixtures.js";

const messages = getMessages("en");

describe("SiteHeader", () => {
  it("links every one of the six pages", () => {
    const html = renderToStaticMarkup(
      <SiteHeader messages={messages} locale="en" localeCount={1} />,
    );
    for (const path of ["/en", "/en/support", "/en/privacy", "/en/terms", "/en/installed-apps", "/en/data-deletion"]) {
      expect(html).toContain(`href="${path}"`);
    }
  });

  it("renders no language switcher while only one locale exists", () => {
    const html = renderToStaticMarkup(
      <SiteHeader messages={messages} locale="en" localeCount={1} />,
    );
    expect(html).not.toContain("data-language-switcher");
  });
});

describe("SiteFooter", () => {
  it("publishes the controller, DPO, NPC and support contacts", () => {
    const html = renderToStaticMarkup(
      <SiteFooter messages={messages} contacts={COMPLETE_CONTACTS} locale="en" />,
    );
    expect(html).toContain(COMPLETE_CONTACTS.PIC_LEGAL_NAME);
    expect(html).toContain(COMPLETE_CONTACTS.DPO_EMAIL);
    expect(html).toContain(COMPLETE_CONTACTS.NPC_REGISTRATION);
    expect(html).toContain(`mailto:${COMPLETE_CONTACTS.SUPPORT_EMAIL}`);
  });

  it("shows the unfilled marker verbatim when a contact is not configured", () => {
    const html = renderToStaticMarkup(
      <SiteFooter messages={messages} contacts={HOLLOW_CONTACTS} locale="en" />,
    );
    expect(html).toContain("[ REQUIRED: DPO_EMAIL ]");
  });
});
