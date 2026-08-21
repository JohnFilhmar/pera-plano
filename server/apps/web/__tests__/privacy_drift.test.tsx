import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyPage } from "@/components/pages/privacy_page.js";
import { getMessages } from "@/messages/index.js";
import { extractTable, sectionHeadingText } from "@/test_support/html.js";
import { extractSection, extractStatusLine, parseFirstTable } from "@/test_support/markdown_table.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

// The one thing that breaks if server/ is ever extracted into its own repository.
const DOC_PATH = fileURLToPath(
  new URL("../../../../docs/07-privacy-and-compliance.md", import.meta.url),
);
const LIFECYCLE_HEADING = "## 4. Data lifecycle";

// Spec §6.2: this test is scoped to the `en` catalog on purpose. A translated fil.json
// cannot be string-compared against an English table; when it lands its guard is a human
// review gate plus a structural row/column-count check, not this comparison.

function doc(): string {
  if (!existsSync(DOC_PATH)) {
    throw new Error(
      `The privacy source document is missing at ${DOC_PATH}. This test binds the ` +
        "published retention table to docs/07-privacy-and-compliance.md §4; if server/ " +
        "moved, fix the path rather than deleting the test.",
    );
  }
  return readFileSync(DOC_PATH, "utf8");
}

function renderedPrivacy(): string {
  return renderToStaticMarkup(
    <PrivacyPage messages={getMessages("en")} config={COMPLETE_CONFIG} />,
  );
}

describe("privacy notice / lifecycle table drift", () => {
  it("finds a lifecycle table with at least the eight rows §4 documents", () => {
    const table = parseFirstTable(extractSection(doc(), LIFECYCLE_HEADING));
    expect(table.rows.length).toBeGreaterThanOrEqual(8);
    expect(table.headers.length).toBeGreaterThanOrEqual(6);
  });

  // privacy §2.4: "retention periods (matching the lifecycle table in §4 exactly)".
  // Editing §4 without editing messages/en.json must fail here.
  it("renders every row and every column of §4 verbatim", () => {
    const fromDoc = parseFirstTable(extractSection(doc(), LIFECYCLE_HEADING));
    const fromPage = extractTable(renderedPrivacy(), "lifecycle");
    expect(fromPage.headers).toEqual(fromDoc.headers);
    expect(fromPage.rows).toEqual(fromDoc.rows);
  });

  it("names the draft it derives from, so the page cannot claim a freshness the doc lacks", () => {
    expect(getMessages("en").privacy.sourceStatus).toBe(extractStatusLine(doc()));
    expect(renderedPrivacy()).toContain(extractStatusLine(doc()));
  });

  it("renders a non-empty heading and no unfilled marker when configuration is complete", () => {
    const html = renderedPrivacy();
    expect(html).not.toContain("[ REQUIRED:");
    expect(html).toContain("<h1");
  });

  // The anchors alone are not the requirement. Asserting `id="..."` substring presence
  // passes for a section emptied down to its own opening tag, which is exactly how a
  // required disclosure disappears without anyone noticing — so read the heading too.
  it("covers every item RA 10173 §2.4 requires the notice to contain", () => {
    const html = renderedPrivacy();
    for (const anchor of [
      "who-is-responsible",
      "why-we-process",
      "what-data-exists",
      "how-processing-happens",
      "who-receives-it",
      "automated-decisions",
      "your-rights",
      "complaints",
      "not-requested",
      "other-peoples-names",
      "if-something-goes-wrong",
    ]) {
      expect(html).toContain(`id="${anchor}"`);
      expect(sectionHeadingText(html, anchor).length).toBeGreaterThan(0);
    }
  });

  // §2.5 calls NPC registration a planning position with confirmation deferred to
  // counsel, and §2.7's breach preparation is written down but unbuilt. Neither may be
  // rendered as settled — the same rule that kept the unwritten PIA off this page.
  it("does not render planning positions or unbuilt preparations as facts", () => {
    const sections = getMessages("en").privacy.sections;
    const responsible = sections.whoIsResponsible.paragraphs.join(" ");
    expect(responsible).toContain("planning position");
    expect(responsible).toContain("counsel");

    const breach = sections.ifSomethingGoesWrong.paragraphs.join(" ");
    expect(breach).toContain("none of it has been built yet");

    // §2.1 requires the outsourcing agreement *before* cloud backup ships, and
    // SERVICE_CAPABILITIES.cloudBackup is false, so no processor holds anything today.
    expect(sections.whoReceivesIt.paragraphs[0]).toContain("has not shipped");
  });
});
