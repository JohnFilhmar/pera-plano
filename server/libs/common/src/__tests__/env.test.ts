import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_FIELDS,
  DEFAULT_PUBLIC_BASE_URL,
  InvalidConfigError,
  MissingComplianceConfigError,
  assertProductionConfig,
  parseEnvironment,
  requiredMarker,
} from "../config/env.js";

const COMPLETE = {
  NODE_ENV: "production",
  PIC_LEGAL_NAME: "Example Controller Inc.",
  PIC_ADDRESS: "1 Example Street, Manila",
  DPO_NAME: "Example Officer",
  DPO_EMAIL: "dpo@example.test",
  SUPPORT_EMAIL: "support@example.test",
  NPC_REGISTRATION: "registration pending",
  PUBLIC_BASE_URL: "https://example.test/",
} as const;

describe("requiredMarker", () => {
  it("uses the exact bracket-and-space format the pages and smoke tests assert", () => {
    expect(requiredMarker("DPO_EMAIL")).toBe("[ REQUIRED: DPO_EMAIL ]");
  });
});

describe("parseEnvironment", () => {
  it("accepts a complete environment with nothing missing", () => {
    const { config, missing } = parseEnvironment(COMPLETE);
    expect(missing).toEqual([]);
    expect(config.contacts.DPO_EMAIL).toBe("dpo@example.test");
    expect(config.nodeEnv).toBe("production");
  });

  it("strips the trailing slash from PUBLIC_BASE_URL so concatenation cannot produce '//'", () => {
    expect(parseEnvironment(COMPLETE).config.publicBaseUrl).toBe("https://example.test");
  });

  it("falls back to the production hostname when PUBLIC_BASE_URL is unset", () => {
    const { config } = parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: undefined });
    expect(config.publicBaseUrl).toBe(DEFAULT_PUBLIC_BASE_URL);
  });

  it("reports every unsupplied compliance field, in declaration order, and marks each value", () => {
    const { config, missing } = parseEnvironment({ NODE_ENV: "development" });
    expect(missing).toEqual([...COMPLIANCE_FIELDS]);
    expect(config.contacts.PIC_LEGAL_NAME).toBe("[ REQUIRED: PIC_LEGAL_NAME ]");
    expect(config.contacts.NPC_REGISTRATION).toBe("[ REQUIRED: NPC_REGISTRATION ]");
  });

  it("marks only the fields that are actually absent", () => {
    const { config, missing } = parseEnvironment({ ...COMPLETE, DPO_EMAIL: undefined });
    expect(missing).toEqual(["DPO_EMAIL"]);
    expect(config.contacts.DPO_EMAIL).toBe("[ REQUIRED: DPO_EMAIL ]");
    expect(config.contacts.DPO_NAME).toBe("Example Officer");
  });

  it("treats a blank or whitespace-only value as absent", () => {
    const { missing } = parseEnvironment({ ...COMPLETE, PIC_ADDRESS: "   " });
    expect(missing).toEqual(["PIC_ADDRESS"]);
  });

  it("treats a malformed email as absent rather than publishing it", () => {
    const { config, missing } = parseEnvironment({ ...COMPLETE, SUPPORT_EMAIL: "not-an-email" });
    expect(missing).toEqual(["SUPPORT_EMAIL"]);
    expect(config.contacts.SUPPORT_EMAIL).toBe("[ REQUIRED: SUPPORT_EMAIL ]");
  });

  it("throws on a malformed PUBLIC_BASE_URL, which is an operator error and not a missing legal fact", () => {
    expect(() => parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: "peraplano.filhmar.online" }))
      .toThrow(InvalidConfigError);
  });

  it("throws on a non-http scheme", () => {
    expect(() => parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: "ftp://example.test" }))
      .toThrow(InvalidConfigError);
  });

  it("throws on an unknown LOG_LEVEL rather than silently defaulting", () => {
    expect(() => parseEnvironment({ ...COMPLETE, LOG_LEVEL: "verbose" })).toThrow(InvalidConfigError);
  });
});

describe("assertProductionConfig", () => {
  it("does not throw when nothing is missing", () => {
    expect(() => assertProductionConfig(parseEnvironment(COMPLETE))).not.toThrow();
  });

  it("throws MissingComplianceConfigError naming EVERY missing field, not just the first", () => {
    const result = parseEnvironment({ ...COMPLETE, DPO_EMAIL: undefined, NPC_REGISTRATION: undefined });
    let caught: unknown;
    try {
      assertProductionConfig(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingComplianceConfigError);
    const err = caught as MissingComplianceConfigError;
    expect(err.missing).toEqual(["DPO_EMAIL", "NPC_REGISTRATION"]);
    expect(err.message).toContain("DPO_EMAIL");
    expect(err.message).toContain("NPC_REGISTRATION");
    expect(err.message).toContain("server/.env.example");
  });
});
