import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION, MIN_FILL_MS } from "@/types/beta_signup.js";

const WEBHOOK = "https://script.example.test/macros/s/fake/exec";
const TOKEN = "fixture-token-0123456789abcdef";

/**
 * getConfig() memoises process.env at first call, and the route's rate limiter is
 * module-level state. Both are deliberate in production and both have to be thrown away
 * between tests, so every case loads the module fresh.
 */
async function loadRoute(configured: boolean) {
  vi.resetModules();
  if (configured) {
    process.env["BETA_SIGNUP_WEBHOOK_URL"] = WEBHOOK;
    process.env["BETA_SIGNUP_TOKEN"] = TOKEN;
  } else {
    delete process.env["BETA_SIGNUP_WEBHOOK_URL"];
    delete process.env["BETA_SIGNUP_TOKEN"];
  }
  return import("@/app/api/beta-signup/route.js");
}

function submission(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://example.test/api/beta-signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      googleEmail: "Tester@Example.test",
      firstName: "Juan",
      deviceModel: "Samsung A54",
      consent: true,
      company: "",
      elapsedMs: MIN_FILL_MS + 1_000,
      ...overrides,
    }),
  });
}

function upstreamOk(duplicate = false): typeof fetch {
  return vi.fn(() => Promise.resolve(Response.json({ ok: true, duplicate })));
}

/** The mocked fetch's recorded body, narrowed so lint does not have to guess at its type. */
function sentBody(fetchMock: typeof fetch): Record<string, unknown> {
  const calls = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  const first = calls[0];
  if (first === undefined) throw new Error("fetch was never called");
  const body = first[1].body;
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(body) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["BETA_SIGNUP_WEBHOOK_URL"];
  delete process.env["BETA_SIGNUP_TOKEN"];
});

describe("POST /api/beta-signup", () => {
  it("answers 503 when no webhook is configured, instead of pretending to save", async () => {
    const { POST } = await loadRoute(false);
    const response = await POST(submission());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "closed" });
  });

  it("rejects an address that is not an email", async () => {
    const { POST } = await loadRoute(true);
    const fetchMock = upstreamOk();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(submission({ googleEmail: "not-an-address" }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a submission with the consent box unticked", async () => {
    const { POST } = await loadRoute(true);
    const fetchMock = upstreamOk();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(submission({ consent: false }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A bland success, on purpose. Telling a bot which check caught it is free tuning
  // information; what matters is that the row is never written.
  it("swallows a filled honeypot without writing a row or admitting anything", async () => {
    const { POST } = await loadRoute(true);
    const fetchMock = upstreamOk();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(submission({ company: "Acme" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a form completed faster than a person could read it", async () => {
    const { POST } = await loadRoute(true);
    const fetchMock = upstreamOk();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(submission({ elapsedMs: 200 }));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid submission with the token and a normalised address", async () => {
    const { POST } = await loadRoute(true);
    const fetchMock = upstreamOk();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(submission());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(WEBHOOK, expect.anything());
    const sent = sentBody(fetchMock);
    expect(sent["token"]).toBe(TOKEN);
    // Play matches tester addresses case-insensitively; the sheet must not hold the same
    // person twice under two capitalisations.
    expect(sent["google_email"]).toBe("tester@example.test");
    expect(sent["first_name"]).toBe("Juan");
    expect(sent["consent_version"]).toBe(CONSENT_VERSION);
  });

  it("reports a duplicate as a success, because signing up twice is not an error", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal("fetch", upstreamOk(true));
    const response = await POST(submission());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
  });

  it("answers 502 when the spreadsheet refuses the write", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ ok: false, error: "unauthorised" }))),
    );
    const response = await POST(submission());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "server" });
  });

  // Regression guard for a silent data loss. Apps Script answers a POST with a 302 and the
  // result is fetched from the redirect target; if that hop ever landed on doGet instead of
  // the stored doPost result, the reply is `{ ok: true, service: … }` with no `duplicate`
  // field. A plain `ok` check would have called that a successful signup and written
  // nothing. Verified against the live deployment on 2026-08-31, which does behave
  // correctly — this exists so it stays that way.
  it("refuses a success that carries no proof the row was written", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ ok: true, service: "peraplano-beta-signup" })),
      ),
    );
    const response = await POST(submission());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "server" });
  });

  it("answers 502 when the upstream call throws, and leaks nothing about why", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED 10.0.0.1:443"))),
    );
    const response = await POST(submission());
    expect(response.status).toBe(502);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("10.0.0.1");
  });

  it("stops answering after a burst from one address", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal("fetch", upstreamOk());
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" };
    const burst = () =>
      POST(
        new Request("https://example.test/api/beta-signup", {
          method: "POST",
          headers,
          body: JSON.stringify({
            googleEmail: "tester@example.test",
            firstName: "Juan",
            deviceModel: "",
            consent: true,
            company: "",
            elapsedMs: MIN_FILL_MS + 1_000,
          }),
        }),
      );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      statuses.push((await burst()).status);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  // Never send a personal email address to a logger. Retention promises on /privacy mean
  // nothing if the same address is sitting in an application log with its own lifetime.
  it("never writes the address to stdout or stderr", async () => {
    const { POST } = await loadRoute(true);
    vi.stubGlobal("fetch", upstreamOk());
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await POST(submission());

    const written = [...out.mock.calls, ...err.mock.calls].map((call) => String(call[0])).join("");
    out.mockRestore();
    err.mockRestore();
    expect(written).not.toContain("tester@example.test");
    expect(written).not.toContain(TOKEN);
  });
});
