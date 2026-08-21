import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupportPage } from "@/components/pages/support_page.js";
import { getMessages } from "@/messages/index.js";
import { extractTable, sectionHeadingText, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG, HOLLOW_CONFIG } from "@/test_support/env_fixtures.js";

const render = (config = COMPLETE_CONFIG): string =>
  renderToStaticMarkup(<SupportPage messages={getMessages("en")} config={config} />);

describe("/support", () => {
  it("publishes the support mailbox as a mailto link", () => {
    expect(render()).toContain(`mailto:${COMPLETE_CONFIG.contacts.SUPPORT_EMAIL}`);
  });

  // Ledger Ruling 5: privacy §7's table has FOURTEEN data rows, not the thirteen the
  // plan guessed. The source was counted; the number here follows the source.
  it("reproduces all fourteen user controls from privacy §7", () => {
    expect(extractTable(render(), "controls").rows).toHaveLength(14);
  });

  it("reproduces all seven data-subject rights from privacy §2.8", () => {
    expect(extractTable(render(), "rights").rows).toHaveLength(7);
  });

  // privacy §2.3 warns users not to paste raw notification text; §4 row 8 caps support
  // mail at 24 months. The warning without the retention period does not explain itself,
  // so both facts are required on the page (spec §4.2 section 2).
  it("warns against pasting raw notification text and states how long support mail is kept", () => {
    const text = stripTags(render());
    expect(text).toContain("raw notification text");
    expect(text).toContain("24 months");
  });

  it("names the NPC as the complaint route", () => {
    expect(stripTags(render())).toContain("National Privacy Commission");
  });

  // Spec §4.0.1: no repo document supplies an NPC address, phone or URL, so inventing
  // one is the exact failure this site is built to avoid.
  it("does not invent an NPC address or link", () => {
    expect(render()).not.toContain("privacy.gov.ph");
    expect(stripTags(render())).not.toContain("http");
  });

  it("shows the unfilled marker rather than a blank when the DPO is not configured", () => {
    expect(render(HOLLOW_CONFIG)).toContain("[ REQUIRED: DPO_NAME ]");
  });

  // Owner's ruling of 2026-08-21. Naming the empty seats on the page where someone would
  // actually write to us is the point: the tone that attracts a real DPO is the tone that
  // admits the seat is empty.
  it("names the three unfilled compliance roles and says why they are visible", () => {
    const text = stripTags(render());
    expect(text).toContain("Personal Information Controller");
    expect(text).toContain("Data Protection Officer");
    expect(text).toContain("National Privacy Commission");
    expect(text).toContain("worse than an admitted gap");
  });

  it("keeps every section anchor backed by a real heading", () => {
    const html = render();
    for (const anchor of [
      "how-to-reach-us",
      "before-you-write",
      "controls",
      "rights",
      "dpo",
      "unfilled-roles",
      "complaints",
    ]) {
      expect(sectionHeadingText(html, anchor).length).toBeGreaterThan(0);
    }
  });
});
