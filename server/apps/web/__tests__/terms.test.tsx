import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermsPage } from "@/components/pages/terms_page.js";
import { getMessages } from "@/messages/index.js";
import { TERMS_EFFECTIVE_DATE, formatPublicationDate } from "@peraplano/common";
import { extractTable, sectionHeadingText, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const html = (): string =>
  renderToStaticMarkup(<TermsPage messages={getMessages("en")} config={COMPLETE_CONFIG} />);

describe("/terms", () => {
  it("reproduces the eleven-row tier matrix from the brief §8", () => {
    expect(extractTable(html(), "tiers").rows).toHaveLength(11);
  });

  it("states the permanent non-goals as disclaimers", () => {
    const text = stripTags(html());
    expect(text).toContain("never holds, moves, or touches");
    expect(text).toContain("not a financial advisor");
  });

  it("says prices are not published yet rather than inventing one", () => {
    const text = stripTags(html());
    expect(text).toContain("not published");
    expect(text).not.toMatch(/₱\s?\d/);
  });

  // The block is deliberately visible. Removing it must be a conscious act in a diff,
  // which is what this assertion makes it. It shrank from seven clauses to two when five
  // were drafted in-house and published as DRAFT; the two that remain are the two blocked
  // on a decision outside this document, not on someone finding the time to write them.
  it("carries the counsel-required block naming the two clauses that stay undrafted", () => {
    const text = stripTags(html());
    expect(text).toContain("Clauses a lawyer still has to write");
    expect(text).toContain("Governing law");
    expect(text).toContain("refund");
    expect(text).toContain("cannot be offered for sale");
    expect(getMessages("en").counselRequired.clauses).toHaveLength(2);
  });

  // Spec rule §4.0.2 forbids approximating counsel prose and silently passing it off as
  // reviewed. Drafting it and stamping DRAFT on every clause is the same rule honoured a
  // different way: the reader can still tell reviewed from unreviewed at a glance.
  it("marks all five in-house clauses as drafts awaiting counsel review", () => {
    const rendered = html();
    expect([...rendered.matchAll(/data-draft-clause/g)]).toHaveLength(5);
    expect(stripTags(rendered)).toContain("DRAFT");
  });

  // The unusual shape of this clause is the point, and the draft says why rather than
  // leaving a reader to wonder what was left out. Written so it stays true the day a
  // sign-in identity lands: SERVICE_CAPABILITIES.accounts flipping does not falsify it.
  it("grounds termination in there being no account to suspend", () => {
    const text = stripTags(html());
    expect(text).toContain("uninstall");
    expect(text).toContain("no account");
  });

  // The clause is grounded in this product's real failure modes, which the page already
  // names one section earlier, rather than in a generic warranty template.
  it("ties the liability clause to the parse failures the page already admits", () => {
    const text = stripTags(html());
    expect(text).toContain("misread");
    expect(text).toContain("counted twice");
  });

  // Liability caps are not boilerplate in the Philippines. A US-shaped cap can be void
  // here, so the draft states the shape and explicitly leaves the limits to counsel.
  it("flags the liability clause as the most jurisdiction-sensitive and asserts no cap", () => {
    const text = stripTags(html());
    expect(text).toContain("most jurisdiction-sensitive");
    expect(text).toContain("Civil Code");
    expect(text).toContain("1170");
    expect(text).toContain("Consumer Act");
    expect(text).toContain("No cap is stated here");
  });

  // Wired to a constant, not written into a sentence. A date living in prose rots in
  // silence — the terms change, the sentence does not, and nothing fails.
  it("renders the effective date from the shared constant, not from catalog prose", () => {
    const rendered = html();
    // Case-insensitive on the attribute name: React 19 emits the JSX prop verbatim
    // (`dateTime`) rather than lowercasing it, and HTML attribute names are ASCII
    // case-insensitive at parse time, so both spellings are the same attribute to a
    // browser. What this pins is that the value came from the constant.
    expect(rendered).toMatch(new RegExp(`<time datetime="${TERMS_EFFECTIVE_DATE}">`, "i"));
    expect(stripTags(rendered)).toContain(formatPublicationDate(TERMS_EFFECTIVE_DATE));
    expect(JSON.stringify(getMessages("en").terms.sections.effectiveDate)).not.toMatch(/\d{4}/);
  });

  it("says purchases run through Google Play and that no payment details are stored", () => {
    const text = stripTags(html());
    expect(text).toContain("Google Play");
    expect(text).toContain("no payment");
  });

  // brief §8: gating "is defined now and enforced later"; privacy §8: privacy controls are
  // never Plus-gated and a cap hides data rather than destroying it. A commercial page that
  // printed the matrix without those two facts would describe a product that does not exist
  // yet as one you are already bound by.
  it("says the matrix is the locked definition, not enforcement that has shipped", () => {
    const text = stripTags(html());
    expect(text).toContain("never deleted");
    expect(text).toContain("never Plus-gated");
    expect(text).toContain("not enforced");
  });

  // Owner ruling, 2026-08-21: no tiering or gating is implemented, and none will be during
  // the testing period. A matrix printed without that fact claims the reader is capped at
  // three Wallets when the build caps nobody — the site describing a constraint the
  // architecture does not perform, which is the Task 8 privacy-intro defect pointing the
  // other way.
  it("says nobody is capped today, not merely that enforcement arrives later", () => {
    const text = stripTags(html());
    expect(text).toContain("full capability");
    expect(text).toContain("No one is on a limited tier today");
  });

  it("keeps every section anchor backed by a real heading", () => {
    const rendered = html();
    for (const anchor of [
      "what-peraplano-is",
      "the-ledger-is-derived",
      "tiers",
      "pricing-not-published",
      "purchases",
      "intellectual-property",
      "termination-and-suspension",
      "limitation-of-liability",
      "changes-to-these-terms",
      "effective-date",
    ]) {
      expect(sectionHeadingText(rendered, anchor).length).toBeGreaterThan(0);
    }
  });
});
