import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, newRequestId, readOrCreateRequestId } from "../correlation/request_id.js";

const headers = (value: string | null) => ({
  get: (name: string) => (name.toLowerCase() === REQUEST_ID_HEADER ? value : null),
});

describe("readOrCreateRequestId", () => {
  it("reuses a sane inbound id so a request keeps one identity across hops", () => {
    expect(readOrCreateRequestId(headers("abc-123"))).toBe("abc-123");
  });

  it("generates one when the header is absent", () => {
    expect(readOrCreateRequestId(headers(null))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an oversized inbound id rather than writing it into every log line", () => {
    expect(readOrCreateRequestId(headers("x".repeat(201)))).not.toContain("xxxx");
  });

  it("rejects control characters, which would forge log-line boundaries", () => {
    expect(readOrCreateRequestId(headers("a\nlevel=error"))).not.toContain("\n");
  });

  it("generates distinct ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
