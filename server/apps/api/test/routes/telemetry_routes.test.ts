import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";

const VALID_BODY = {
  appVersion: "1.0.0",
  rulesetVersion: 1,
  providerKey: "gcash",
  parsed: 120,
  failed: 3,
  periodStart: 1_754_000_000_000,
  periodEnd: 1_754_086_400_000,
};

describe("POST /v1/telemetry/parse_stats", () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app.prisma);
  });

  it("accepts valid aggregate stats with 202 and stores exactly those fields", async () => {
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(202);
    const rows = await app.prisma.telemetryParseStat.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appVersion).toBe("1.0.0");
    expect(rows[0]?.rulesetVersion).toBe(1);
    expect(rows[0]?.providerKey).toBe("gcash");
    expect(rows[0]?.parsed).toBe(120);
    expect(rows[0]?.failed).toBe(3);
    expect(Number(rows[0]?.periodStart)).toBe(VALID_BODY.periodStart);
    expect(Number(rows[0]?.periodEnd)).toBe(VALID_BODY.periodEnd);
    expect(Number(rows[0]?.receivedAt)).toBeGreaterThanOrEqual(before);
  });

  it("rejects content-bearing extra fields, aggregate counts only", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: {
        ...VALID_BODY,
        rawText: "You have sent PHP 1,500.00 to JUAN D.",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
    expect(await app.prisma.telemetryParseStat.count()).toBe(0);
  });

  it("rejects a missing required field", async () => {
    const { providerKey: _omitted, ...withoutProvider } = VALID_BODY;
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: withoutProvider,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects negative counts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: { ...VALID_BODY, parsed: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-integer counts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: { ...VALID_BODY, failed: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("per-IP rate limiting", () => {
  // Separate app with a 2-request budget so the test stays fast.
  const app = buildApp({ telemetryRateLimitMax: 2 });

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns a 429 rate_limited envelope once the per-IP budget is spent", async () => {
    for (let i = 0; i < 2; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/telemetry/parse_stats",
        payload: VALID_BODY,
      });
      expect(ok.statusCode).toBe(202);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe(
      "rate_limited",
    );
  });

  it("keys the budget per IP, a different remote address still passes", async () => {
    const otherIp = await app.inject({
      method: "POST",
      url: "/v1/telemetry/parse_stats",
      payload: VALID_BODY,
      remoteAddress: "10.1.2.3",
    });
    expect(otherIp.statusCode).toBe(202);
  });
});
