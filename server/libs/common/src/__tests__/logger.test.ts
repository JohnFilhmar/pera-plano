import { describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";

function capture(level: Parameters<typeof createLogger>[0]["level"]) {
  const lines: string[] = [];
  const log = createLogger({ service: "web", level, sink: (l) => lines.push(l) });
  return { log, lines };
}

describe("createLogger", () => {
  it("emits one parseable JSON line per call", () => {
    const { log, lines } = capture("info");
    log.info("started", { port: 3000 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed["level"]).toBe("info");
    expect(parsed["service"]).toBe("web");
    expect(parsed["msg"]).toBe("started");
    expect(parsed["port"]).toBe(3000);
    expect(typeof parsed["ts"]).toBe("string");
  });

  it("drops records below the configured level", () => {
    const { log, lines } = capture("warn");
    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    log.error("kept");
    expect(lines).toHaveLength(2);
  });

  it("redacts field values whose key names a secret or a person", () => {
    const { log, lines } = capture("info");
    log.info("contact", { email: "someone@example.test", apiToken: "abc", port: 3000 });
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed["email"]).toBe("[redacted]");
    expect(parsed["apiToken"]).toBe("[redacted]");
    expect(parsed["port"]).toBe(3000);
  });

  it("carries child fields onto every record", () => {
    const { log, lines } = capture("info");
    log.child({ requestId: "r-1" }).info("hit");
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed["requestId"]).toBe("r-1");
  });
});
