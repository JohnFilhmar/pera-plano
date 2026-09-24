import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config.js";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * The headers are asserted from the config rather than from a live response on purpose:
 * this suite must stay runnable in a second with no build and no socket. The smoke suite
 * boots the real standalone server and proves the same names actually reach the wire,
 * which is the half a config read cannot cover.
 */
async function headerRules() {
  const headers = nextConfig.headers;
  if (headers === undefined) throw new Error("next.config.ts defines no headers()");
  return await headers();
}

async function headerMap(): Promise<Map<string, string>> {
  const rules = await headerRules();
  return new Map(rules.flatMap((rule) => rule.headers.map((h) => [h.key.toLowerCase(), h.value])));
}

async function csp(): Promise<Map<string, string>> {
  const value = (await headerMap()).get("content-security-policy") ?? "";
  return new Map(
    value.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name ?? "", sources.join(" ")];
    }),
  );
}

describe("security headers", () => {
  it("applies one rule that covers every path, including the root", async () => {
    const rules = await headerRules();
    expect(rules).toHaveLength(1);
    // A second rule would mean a second policy to keep in step; a source narrower than
    // this would leave some responses bare, which is the state this file exists to end.
    expect(rules[0]?.source).toBe("/:path*");
  });

  it("sends the whole set", async () => {
    const headers = await headerMap();
    expect([...headers.keys()].sort()).toEqual([
      "content-security-policy",
      "referrer-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
    ]);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("closes the directives an injected tag would otherwise reach through", async () => {
    const directives = await csp();
    expect(directives.get("default-src")).toBe("'self'");
    // frame-ancestors is the modern half of the X-Frame-Options pair and the one that
    // stops the overlay copy of the beta form; form-action is what stops an injected form
    // from posting the email it collects to somewhere that is not us.
    expect(directives.get("frame-ancestors")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'self'");
    expect(directives.get("base-uri")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
  });

  it("names no origin but our own", async () => {
    // The privacy notice claims this site makes zero third-party requests. A CSP that
    // allowlisted a CDN or a font host would be the first place that claim quietly stops
    // being true, so the policy is the assertion.
    const value = (await headerMap()).get("content-security-policy") ?? "";
    expect(value).not.toMatch(/https?:/);
    expect(value).not.toContain("*");
  });

  it("never permits eval", async () => {
    const value = (await headerMap()).get("content-security-policy") ?? "";
    expect(value).not.toContain("unsafe-eval");
  });

  it("is a single well-formed header line", async () => {
    // A template literal split over lines produces a header that browsers accept and then
    // silently mis-parse; the directives after the newline stop applying.
    const value = (await headerMap()).get("content-security-policy") ?? "";
    expect(value).not.toMatch(/[\n\r]/);
    expect(value).not.toMatch(/;\s*;/);
  });

  it("keeps script-src able to run the inline bootstrap the layout still ships", async () => {
    // The coupling this catches: app/layout.tsx injects a theme bootstrap with
    // dangerouslySetInnerHTML, and every App Router response carries Next's own inline
    // self.__next_f payload. Tightening script-src without also removing those, or
    // switching to a per-request nonce, would leave the site unhydrated.
    const layout = readFileSync(`${WEB_ROOT}app/layout.tsx`, "utf8");
    expect(layout).toContain("dangerouslySetInnerHTML");
    expect((await csp()).get("script-src")).toMatch(/'unsafe-inline'|'nonce-/);
  });

  it("starts HSTS at a max-age short enough to walk back", async () => {
    // One day until certbot has renewed unattended at least once. See the note in
    // next.config.ts: a year is the value you cannot take back.
    const value = (await headerMap()).get("strict-transport-security") ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1] ?? "0");
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(31_536_000);
    expect(value).toContain("includeSubDomains");
    // preload is a one-way door and must not be added before the max-age is a full year.
    if (value.includes("preload")) expect(maxAge).toBe(31_536_000);
  });
});
