import { describe, it, expect } from "vitest";
import { INITIAL_RULESET } from "../prisma/seed_data.js";

describe("initial parser ruleset seed", () => {
  it("is version 1 and covers gcash, maya, and bpi in order", () => {
    expect(INITIAL_RULESET.version).toBe(1);
    expect(INITIAL_RULESET.providers.map((p) => p.providerKey)).toEqual([
      "gcash",
      "maya",
      "bpi",
    ]);
  });

  it("gives every provider at least one package name and one template", () => {
    for (const provider of INITIAL_RULESET.providers) {
      expect(provider.packageNames.length).toBeGreaterThanOrEqual(1);
      expect(provider.templates.length).toBeGreaterThanOrEqual(1);
      expect(provider.version).toBe(1);
    }
  });

  it("compiles every template regex, each with an amount named group and a 0..1 confidence", () => {
    for (const provider of INITIAL_RULESET.providers) {
      for (const template of provider.templates) {
        const regex = new RegExp(template.match); // throws if invalid
        expect(regex).toBeInstanceOf(RegExp);
        expect(template.match).toContain("(?<amount>");
        expect(template.confidence).toBeGreaterThan(0);
        expect(template.confidence).toBeLessThanOrEqual(1);
        if (template.direction !== undefined) {
          expect(["in", "out"]).toContain(template.direction);
        }
      }
    }
  });

  it("extracts fields from the illustrative gcash send sample", () => {
    const sendTemplate = INITIAL_RULESET.providers[0]?.templates.find(
      (t) => t.id === "gcash_send_v1",
    );
    expect(sendTemplate).toBeDefined();
    const match = new RegExp(sendTemplate?.match ?? "").exec(
      "You have sent ₱1,500.00 to JUAN D. Ref No. 90210XXXX. Your new balance is ₱2,350.75.",
    );
    expect(match?.groups?.amount).toBe("1,500.00");
    expect(match?.groups?.counterparty).toBe("JUAN D");
    expect(match?.groups?.ref).toBe("90210XXXX");
    expect(match?.groups?.balance).toBe("2,350.75");
  });
});
