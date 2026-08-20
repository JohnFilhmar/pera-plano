import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SERVICE_CAPABILITIES } from "@peraplano/common";
import { DataDeletionPage } from "@/components/pages/data_deletion_page.js";
import { PrivacyPage } from "@/components/pages/privacy_page.js";
import { getMessages } from "@/messages/index.js";
import { stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const messages = getMessages("en");
const deletion = () =>
  renderToStaticMarkup(<DataDeletionPage messages={messages} config={COMPLETE_CONFIG} />);

describe("/data-deletion", () => {
  it("states there is nothing on a server to delete", () => {
    expect(stripTags(deletion())).toContain("no copy on our servers");
  });

  it("never implies an account exists", () => {
    const text = stripTags(deletion()).toLowerCase();
    expect(text).not.toContain("your account");
    expect(text).not.toContain("sign in to delete");
    expect(text).not.toContain("log in");
  });

  it("gives all three destructive routes", () => {
    const text = stripTags(deletion());
    expect(text).toContain("Wipe everything");
    expect(text).toContain("Settings");
    expect(text).toContain("Clear data");
    expect(text).toContain("Uninstall");
  });

  it("says raw notification text purges itself after 30 days", () => {
    expect(stripTags(deletion())).toContain("30 days");
  });

  // Both figures below come from a document still marked as a draft. privacy_drift.test.tsx
  // binds privacy.sourceStatus to the document status line, and this page substitutes that
  // same key, so the chain is: document -> privacy.sourceStatus -> this page.
  it("names the draft it takes its retention figures from", () => {
    const text = stripTags(deletion());
    expect(text).toContain("24 months");
    expect(text).toContain(messages.privacy.sourceStatus);
    expect(text).toContain("has not been reviewed by Philippine privacy counsel");
  });

  it("describes a future deletion route only in the conditional", () => {
    const text = stripTags(deletion());
    expect(text).toContain("does not offer accounts today");
    expect(SERVICE_CAPABILITIES.accounts).toBe(false);
  });

  // Two pages disagreeing about whether a server holds your money data is the failure
  // a regulator finds by reading both in one sitting. One catalog entry, one component.
  it("renders the same service-status text as /privacy, byte for byte", () => {
    const extract = (html: string): string => {
      const match = /<aside\b[^>]*data-service-status[^>]*>([\s\S]*?)<\/aside>/i.exec(html);
      if (match?.[1] === undefined) throw new Error("no service-status block found");
      return stripTags(match[1]);
    };
    expect(extract(deletion())).toBe(
      extract(renderToStaticMarkup(<PrivacyPage messages={messages} config={COMPLETE_CONFIG} />)),
    );
  });
});
