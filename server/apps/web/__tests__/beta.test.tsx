import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BetaPage } from "@/components/pages/beta_page.js";
import { getMessages } from "@/messages/index.js";
import { firstHeadingText, stripTags } from "@/test_support/html.js";
import { BETA_CONFIG, COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const open = (): string =>
  renderToStaticMarkup(
    <BetaPage messages={getMessages("en")} config={BETA_CONFIG} locale="en" />,
  );

/** COMPLETE_CONFIG has no beta webhook, which is the state the site ships in today. */
const closed = (): string =>
  renderToStaticMarkup(
    <BetaPage messages={getMessages("en")} config={COMPLETE_CONFIG} locale="en" />,
  );

describe("/beta", () => {
  it("leads with the offer in its own heading", () => {
    expect(firstHeadingText(open()).length).toBeGreaterThan(0);
    expect(stripTags(open())).toContain("Keep Plus for life");
  });

  // The app ships Free and Plus. "Pro" is a tier that does not exist in entitlements.ts,
  // and inventing one on a public page is a promise nobody can honour.
  it("names the tier Plus and never Pro", () => {
    const text = stripTags(open());
    expect(text).toContain("Plus");
    expect(text).not.toMatch(/\bPro\b/);
  });

  // The single most important assertion on this page. A signup form that asks for a Google
  // account email is shaped exactly like a phishing page; the thing that makes it not one
  // is that it never asks for the credential itself.
  it("has no password field anywhere, and says so in words", () => {
    const html = open();
    expect(html).not.toMatch(/type="password"/i);
    expect(stripTags(html)).toContain("never ask for your password");
  });

  it("asks for consent explicitly rather than assuming it", () => {
    const html = open();
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="consent"');
    expect(html).toContain("required");
  });

  it("states the purpose, the retention and the way out before asking", () => {
    const text = stripTags(open());
    expect(text).toContain("Google Play Console");
    expect(text).toContain("ninety days");
    expect(text).toContain("removed");
  });

  // Commercial representations live on /terms in this repo. The page makes the offer and
  // points at the clause; it does not restate the clause.
  it("sends the reader to the terms clause and the privacy notice", () => {
    expect(open()).toContain('href="/en/terms"');
    expect(open()).toContain('href="/en/privacy"');
  });

  it("quotes no price, because the brief leaves pricing undecided", () => {
    const text = stripTags(open());
    expect(text).not.toMatch(/₱\s?\d/);
    expect(text).not.toMatch(/\d\s*(\/|per\s)(mo|month|year|yr)/i);
  });

  it("renders no href=\"#\" placeholder", () => {
    expect(open()).not.toContain('href="#"');
  });

  // With no webhook configured the page must not render a form that silently fails. Same
  // rule the compliance markers follow: publish the truth, never a dead control.
  it("replaces the form with a support route when signups are not configured", () => {
    const html = closed();
    expect(html).not.toContain('name="googleEmail"');
    expect(stripTags(html)).toContain("Signups are not open");
    expect(html).toContain(`mailto:${COMPLETE_CONFIG.contacts.SUPPORT_EMAIL}`);
  });

  it("still renders the offer and the obligations when signups are closed", () => {
    const text = stripTags(closed());
    expect(text).toContain("Keep Plus for life");
    expect(text).toContain("What we are asking of you");
  });

  // The no-JavaScript path bounces back here with ?submitted=. Rendering the success state
  // server-side is what makes that path real rather than nominal.
  it("renders the success state from the query string, for the no-script path", () => {
    const html = renderToStaticMarkup(
      <BetaPage
        messages={getMessages("en")}
        config={BETA_CONFIG}
        locale="en"
        submitted="ok"
      />,
    );
    expect(stripTags(html)).toContain("You are on the list");
  });

  it("posts to a real endpoint so the form works without JavaScript", () => {
    const html = open();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/beta-signup"');
    expect(html).toContain('name="locale"');
  });
});
