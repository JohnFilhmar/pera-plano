import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "123.apps.googleusercontent.com",
  PLAY_PACKAGE_NAME: "com.filldev.peraplano",
  PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b","private_key":"pem"}',
  BETA_WINDOW_START_AT: "1750000000000",
  BETA_WINDOW_END_AT: "1760000000000",
} as NodeJS.ProcessEnv;

// The five Google and Play variables are required, so every case that expects
// loadConfig to succeed has to carry them.
const VALID_ENV = {
  DATABASE_URL: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
  JWT_SECRET: "secret",
  ...GOOGLE_ENV,
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("loads required variables and applies defaults", () => {
    const config = loadConfig(VALID_ENV);
    expect(config).toEqual({
      databaseUrl: "postgresql://peraplano:peraplano@localhost:5432/peraplano",
      jwtSecret: "secret",
      port: 3000,
      telemetryRateLimitMax: 60,
      authRateLimitMax: 10,
      googleOauthClientId: "123.apps.googleusercontent.com",
      playPackageName: "com.filldev.peraplano",
      playIntegrityServiceAccountJson: '{"client_email":"a@b","private_key":"pem"}',
      betaWindowStartAt: 1750000000000,
      betaWindowEndAt: 1760000000000,
      googleJwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      integrityMaxSkewMs: 300000,
      googleAuthRateLimitMax: 20,
    });
  });

  it("parses PORT and the rate limit maximums when provided", () => {
    const config = loadConfig({
      ...VALID_ENV,
      PORT: "8080",
      TELEMETRY_RATE_LIMIT_MAX: "5",
      AUTH_RATE_LIMIT_MAX: "3",
    });
    expect(config.port).toBe(8080);
    expect(config.telemetryRateLimitMax).toBe(5);
    expect(config.authRateLimitMax).toBe(3);
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ JWT_SECRET: "s" })).toThrow(
      "DATABASE_URL",
    );
  });

  it("throws when JWT_SECRET is missing", () => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://x" }),
    ).toThrow("JWT_SECRET");
  });

  it("throws on a non-numeric PORT", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, PORT: "not-a-port" }),
    ).toThrow("PORT");
  });

  it("throws on a non-numeric TELEMETRY_RATE_LIMIT_MAX", () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        TELEMETRY_RATE_LIMIT_MAX: "lots",
      }),
    ).toThrow("TELEMETRY_RATE_LIMIT_MAX");
  });

  it("throws on a non-numeric AUTH_RATE_LIMIT_MAX", () => {
    expect(() =>
      loadConfig({
        ...VALID_ENV,
        AUTH_RATE_LIMIT_MAX: "plenty",
      }),
    ).toThrow("AUTH_RATE_LIMIT_MAX");
  });

  it("throws on a zero AUTH_RATE_LIMIT_MAX", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, AUTH_RATE_LIMIT_MAX: "0" }),
    ).toThrow("AUTH_RATE_LIMIT_MAX");
  });
});

describe("loadConfig google and play settings", () => {
  it("applies defaults for the optional variables", () => {
    const config = loadConfig({ ...VALID_ENV, ...GOOGLE_ENV });
    expect(config.googleJwksUrl).toBe("https://www.googleapis.com/oauth2/v3/certs");
    expect(config.integrityMaxSkewMs).toBe(300000);
    expect(config.googleAuthRateLimitMax).toBe(20);
    expect(config.betaWindowStartAt).toBe(1750000000000);
  });

  it("reads the optional variables when they are set", () => {
    const config = loadConfig({
      ...VALID_ENV,
      GOOGLE_JWKS_URL: "https://example.test/certs",
      INTEGRITY_MAX_SKEW_MS: "1000",
      GOOGLE_AUTH_RATE_LIMIT_MAX: "3",
    });
    expect(config.googleJwksUrl).toBe("https://example.test/certs");
    expect(config.integrityMaxSkewMs).toBe(1000);
    expect(config.googleAuthRateLimitMax).toBe(3);
  });

  it.each([
    "GOOGLE_OAUTH_CLIENT_ID",
    "PLAY_PACKAGE_NAME",
    "PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON",
    "BETA_WINDOW_START_AT",
    "BETA_WINDOW_END_AT",
  ])("throws when %s is missing", (key) => {
    const env = { ...VALID_ENV, ...GOOGLE_ENV };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(key);
  });

  it.each(["BETA_WINDOW_START_AT", "BETA_WINDOW_END_AT"])(
    "throws on a non-numeric %s",
    (key) => {
      expect(() => loadConfig({ ...VALID_ENV, [key]: "yesterday" })).toThrow(key);
    },
  );

  it("throws when the beta window ends before it starts", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, ...GOOGLE_ENV, BETA_WINDOW_END_AT: "1740000000000" }),
    ).toThrow("BETA_WINDOW_END_AT");
  });

  it.each(["GOOGLE_AUTH_RATE_LIMIT_MAX", "INTEGRITY_MAX_SKEW_MS"])(
    "throws on a zero %s",
    (key) => {
      expect(() => loadConfig({ ...VALID_ENV, [key]: "0" })).toThrow(key);
    },
  );
});
