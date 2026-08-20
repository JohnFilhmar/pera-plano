import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermsPage } from "@/components/pages/terms_page.js";
import { getMessages } from "@/messages/index.js";
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
  // which is what this assertion makes it.
  it("carries the counsel-required block naming all seven undrafted clauses", () => {
    const text = stripTags(html());
    expect(text).toContain("Clauses a lawyer still has to write");
    expect(text).toContain("Governing law");
    expect(text).toContain("Limitation of liability");
    expect(text).toContain("cannot be offered for sale");
    expect(getMessages("en").counselRequired.clauses).toHaveLength(7);
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

  it("keeps every section anchor backed by a real heading", () => {
    const rendered = html();
    for (const anchor of [
      "what-peraplano-is",
      "the-ledger-is-derived",
      "tiers",
      "pricing-not-published",
      "purchases",
    ]) {
      expect(sectionHeadingText(rendered, anchor).length).toBeGreaterThan(0);
    }
  });
});
