import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The published module is swapped per case, the same shape
 * `beta_signup_route.test.ts` uses for its memoised config: the route reads its
 * bundle from a module-level import, so a fresh import is the only way to test
 * more than one published state.
 */
async function loadRoute(published: {
  body?: string | null;
  signature?: string | null;
  version?: number | null;
}) {
  vi.resetModules();
  vi.doMock("@/rulesets/current_ruleset", () => ({
    RULESET_BODY: published.body ?? null,
    RULESET_SIGNATURE: published.signature ?? null,
    RULESET_VERSION: published.version ?? null,
  }));
  return import("@/app/v1/parser_rules/route.js");
}

/** Deliberately ugly: trailing spaces and unsorted keys, so re-serialization shows. */
const BUNDLE = '{  "version": 7,\n  "providers": [],  "b": 1, "a": 2  }';
const SIGNATURE = "c2lnbmF0dXJlLWJ5dGVz";

function get(url: string): Request {
  return new Request(url);
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/rulesets/current_ruleset");
});

describe("GET /v1/parser_rules", () => {
  it("answers 204 when no ruleset has been published yet", async () => {
    // The channel deploys before any bundle exists, and that is not a failure:
    // the app keeps using its seeded ruleset.
    const { GET } = await loadRoute({});

    const response = GET(get("https://api.example.test/v1/parser_rules"));

    expect(response.status).toBe(204);
  });

  it("serves the published bundle BYTE FOR BYTE, with the signature header", async () => {
    // The whole contract. The client verifies an Ed25519 signature over exactly
    // what it received, so a route that re-serialized would break every device
    // while looking correct in a diff.
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    const response = GET(get("https://api.example.test/v1/parser_rules"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(BUNDLE);
    expect(response.headers.get("x-ruleset-signature")).toBe(SIGNATURE);
  });

  it("uses the lower-cased header name the client reads", async () => {
    // `mobile/lib/ingest/ruleset_signature.ts` reads "x-ruleset-signature" off
    // the response map. A differently-cased header would arrive and be ignored,
    // and the app would discard a valid bundle as unsigned.
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    const response = GET(get("https://api.example.test/v1/parser_rules"));

    expect([...response.headers.keys()]).toContain("x-ruleset-signature");
  });

  it("answers 204 when the caller already has this version", async () => {
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    const same = GET(get("https://api.example.test/v1/parser_rules?since_version=7"));
    const newer = GET(get("https://api.example.test/v1/parser_rules?since_version=9"));

    expect(same.status).toBe(204);
    expect(newer.status).toBe(204);
  });

  it("serves the bundle to a caller behind it", async () => {
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    const response = GET(get("https://api.example.test/v1/parser_rules?since_version=6"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(BUNDLE);
  });

  it("treats a malformed since_version as no version, and still serves", async () => {
    // The safe direction. The client discards a bundle it already holds by
    // version anyway, so an extra response costs one request; refusing would let
    // a mangled query parameter stop a device receiving a parser fix.
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    for (const raw of ["abc", "-1", "7.5", "", "1e3", "٧"]) {
      const response = GET(
        get(`https://api.example.test/v1/parser_rules?since_version=${encodeURIComponent(raw)}`),
      );
      expect(response.status, `since_version=${raw}`).toBe(200);
    }
  });

  it("never lets a response be cached between the body and its signature", async () => {
    // A cached body paired with another version's signature fails verification on
    // every device that receives it, and nothing on the client would say why.
    const { GET } = await loadRoute({ body: BUNDLE, signature: SIGNATURE, version: 7 });

    const response = GET(get("https://api.example.test/v1/parser_rules"));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves nothing when a body is published without its signature", async () => {
    // Belt and braces against a half-written generated module: serving an
    // unsigned body would be discarded by the client as unsigned anyway, so the
    // honest answer is that nothing is published.
    const { GET } = await loadRoute({ body: BUNDLE, signature: null, version: 7 });

    expect(GET(get("https://api.example.test/v1/parser_rules")).status).toBe(204);
  });
});

describe("the published module", () => {
  it("keeps RULESET_VERSION in step with the body it describes", async () => {
    // Two copies of one number is the shape that drifts. This reads the REAL
    // generated module rather than a fixture, so a hand-edit or a bad generator
    // run fails here instead of on a phone.
    vi.resetModules();
    vi.doUnmock("@/rulesets/current_ruleset");
    const published = await import("@/rulesets/current_ruleset.js");

    if (published.RULESET_BODY === null) {
      expect(published.RULESET_SIGNATURE).toBeNull();
      expect(published.RULESET_VERSION).toBeNull();
      return;
    }

    const parsed = JSON.parse(published.RULESET_BODY) as { version?: unknown };
    expect(parsed.version).toBe(published.RULESET_VERSION);
    expect(typeof published.RULESET_SIGNATURE).toBe("string");
  });
});
