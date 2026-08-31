import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
  JWT_SECRET: "secret",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("loads required variables and applies defaults", () => {
    const config = loadConfig(VALID_ENV);
    expect(config).toEqual({
      databaseUrl: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
      jwtSecret: "secret",
      port: 3000,
      telemetryRateLimitMax: 60,
    });
  });

  it("parses PORT and TELEMETRY_RATE_LIMIT_MAX when provided", () => {
    const config = loadConfig({
      ...VALID_ENV,
      PORT: "8080",
      TELEMETRY_RATE_LIMIT_MAX: "5",
    } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.telemetryRateLimitMax).toBe(5);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ JWT_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(
      "DATABASE_URL",
    );
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://x" } as NodeJS.ProcessEnv),
    ).toThrow("JWT_SECRET");
  });

  it("throws on a non-numeric PORT", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, PORT: "not-a-port" } as NodeJS.ProcessEnv),
    ).toThrow("PORT");
  });

  it("throws on a non-numeric TELEMETRY_RATE_LIMIT_MAX", () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        TELEMETRY_RATE_LIMIT_MAX: "lots",
      } as NodeJS.ProcessEnv),
    ).toThrow("TELEMETRY_RATE_LIMIT_MAX");
  });
});
