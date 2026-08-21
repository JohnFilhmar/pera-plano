import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OWNER_SITE_URL } from "@peraplano/common";
import { MarketingPage } from "@/components/pages/marketing_page.js";
import { SupportPage } from "@/components/pages/support_page.js";
import { getMessages } from "@/messages/index.js";
import { firstHeadingText, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

// The locale is an explicit prop rather than a default, because this is the only page that
// builds internal links: a wrong-locale href on the one page every visitor lands on first is
// how a whole language ends up unreachable.
const html = (): string =>
  renderToStaticMarkup(
    <MarketingPage messages={getMessages("en")} config={COMPLETE_CONFIG} locale="en" />,
  );

/**
 * Everything on the page except the one block that is explicitly labelled as an invented
 * example. brief §7 formats money as ₱1,234.56 and brief §5's sample notification uses a
 * peso figure, so a flat "no ₱ digits anywhere" ban would either delete the illustration or
 * force it to be written in a format the brand rules forbid. What actually has to be banned
 * is a *price* — brief §8 leaves pricing undecided — so the ban applies everywhere the
 * illustrative marker does not.
 */
const outsideTheIllustration = (): string =>
  stripTags(html().replace(/<figure\b[^>]*data-illustrative[^>]*>[\s\S]*?<\/figure>/i, " "));

describe("/", () => {
  it("leads with the tagline from the brief §2", () => {
    expect(stripTags(html())).toContain("You never log a transaction; you only set the rules.");
  });

  it("has a non-empty heading", () => {
    expect(firstHeadingText(html()).length).toBeGreaterThan(0);
  });

  it("presents all three personas from the brief §4", () => {
    const text = stripTags(html());
    expect(text).toContain("kinsenas");
    expect(text).toContain("gig");
    expect(text).toContain("e-wallet");
  });

  it("defines the Filipino terms it uses, per the brief §7 voice rule", () => {
    const text = stripTags(html());
    expect(text).toContain("utang");
    expect(text).toContain("padala");
    expect(text).toMatch(/kinsenas\b[^.]*15th and 30th/);
  });

  // brief §5 flags its own sample notification as invented. A fabricated bank message
  // presented as real reads badly at review.
  it("marks the sample notification as illustrative", () => {
    expect(stripTags(html()).toLowerCase()).toContain("illustrative");
    expect(html()).toMatch(/<figure\b[^>]*data-illustrative/i);
  });

  it("quotes no price, because the brief §8 leaves pricing undecided", () => {
    expect(outsideTheIllustration()).not.toMatch(/₱\s?\d/);
    // A billing period only reads as a price when a number is attached to it. Banning the
    // bare words would ban "twice a month", which is the pay cadence the page is about.
    expect(outsideTheIllustration()).not.toMatch(/\d\s*(\/|per\s)(mo|month|year|yr)/i);
  });

  it("renders no Play badge while there is no listing to link to", () => {
    expect(html()).not.toContain('href="#"');
    expect(getMessages("en").marketing.hero.storeBadge).toBeNull();
  });

  // Spec §4.1 section 7: the tier comparison is a commercial representation and lives with
  // the other commercial ones. The marketing page points at it rather than restating it.
  it("sends the reader to /terms for the tier comparison instead of restating it", () => {
    expect(html()).toContain('href="/en/terms"');
    expect(html()).toContain('href="/en/privacy"');
  });

  // The owner's ruling of 2026-08-21: the unfilled-roles admission goes on / and /support
  // and nowhere else. Saying it here is not self-flagellation — a visitor deciding whether
  // to hand a finance app their notification stream is owed the fact that the company
  // behind it does not exist yet.
  it("names the three unfilled compliance roles instead of leaving them to be discovered", () => {
    const text = stripTags(html());
    expect(text).toContain("Personal Information Controller");
    expect(text).toContain("Data Protection Officer");
    expect(text).toContain("National Privacy Commission");
  });

  // Candour, not a pitch: one sentence, and the only way to answer it is the support
  // mailbox that already has to exist for the Play listing.
  it("invites qualified people through the support mailbox", () => {
    expect(html()).toContain(`mailto:${COMPLETE_CONFIG.contacts.SUPPORT_EMAIL}`);
  });

  // Two pages disagreeing about what is missing from a privacy programme is exactly what a
  // regulator finds by reading both in one sitting. One catalog entry, one component.
  it("renders the same unfilled-roles text as /support, byte for byte", () => {
    const extract = (rendered: string): string => {
      const match = /<section\b[^>]*data-unfilled-roles[^>]*>([\s\S]*?)<\/section>/i.exec(rendered);
      if (match?.[1] === undefined) throw new Error("no unfilled-roles block found");
      return stripTags(match[1]);
    };
    expect(extract(html())).toBe(
      extract(
        renderToStaticMarkup(
          <SupportPage messages={getMessages("en")} config={COMPLETE_CONFIG} />,
        ),
      ),
    );
  });

  // The hostname lives in libs/common beside DEFAULT_PUBLIC_BASE_URL, because
  // apps/web/{app,components,messages} is under a blanket ban on the literal and the ban
  // is worth more without an exception list. structure.test.ts enforces the other half.
  it("links the owner's other work from the shared constant, never a catalog literal", () => {
    expect(html()).toContain(`href="${OWNER_SITE_URL}"`);
    expect(JSON.stringify(getMessages("en").marketing.builtAlongside)).not.toContain("filhmar");
  });
});
