import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, getMessages, isSupportedLocale } from "../messages/index.js";

describe("message catalog", () => {
  it("ships exactly one locale, so no language switcher may render yet", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en"]);
  });

  it("accepts a supported locale and rejects anything else", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fil")).toBe(false);
    expect(isSupportedLocale("../../etc/passwd")).toBe(false);
  });

  it("exposes every top-level section the six pages need", () => {
    const m = getMessages("en");
    for (const section of [
      "meta",
      "nav",
      "footer",
      "serviceStatus",
      "counselRequired",
      "marketing",
      "support",
      "privacy",
      "terms",
      "installedApps",
      "dataDeletion",
    ]) {
      expect(m).toHaveProperty(section);
    }
  });

  it("carries the product tagline verbatim from the brief §2", () => {
    expect(getMessages("en").meta.tagline).toBe(
      "You never log a transaction; you only set the rules.",
    );
  });
});
