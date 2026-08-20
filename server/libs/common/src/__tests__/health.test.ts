import { describe, expect, it } from "vitest";
import { buildHealthReport } from "../health/health.js";

describe("buildHealthReport", () => {
  it("reports ok and an integer uptime when configuration is complete", () => {
    expect(
      buildHealthReport({
        service: "web",
        version: "0.1.0",
        startedAt: 1_000,
        now: 6_500,
        configComplete: true,
      }),
    ).toEqual({ status: "ok", service: "web", version: "0.1.0", uptimeSeconds: 5, configComplete: true });
  });

  it("reports degraded when configuration is incomplete", () => {
    const report = buildHealthReport({
      service: "web",
      version: "0.1.0",
      startedAt: 0,
      now: 0,
      configComplete: false,
    });
    expect(report.status).toBe("degraded");
  });

  it("never names which fields are missing — a public endpoint is not a to-do list", () => {
    const report = buildHealthReport({
      service: "web",
      version: "0.1.0",
      startedAt: 0,
      now: 0,
      configComplete: false,
    });
    expect(JSON.stringify(report)).not.toContain("DPO");
  });
});
