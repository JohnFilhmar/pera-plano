import { describe, expect, it } from "vitest";
import { firstHeadingText } from "../apps/web/test_support/html.js";

const BASE = process.env["SMOKE_BASE_URL"] ?? "";

const CONTENT_ROUTES = [
  "/en",
  "/en/support",
  "/en/privacy",
  "/en/terms",
  "/en/installed-apps",
  "/en/data-deletion",
] as const;

describe("production build smoke", () => {
  it("has a base url from the global setup", () => {
    expect(BASE).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it.each(CONTENT_ROUTES)("%s answers 200 with a non-empty heading", async (route) => {
    const response = await fetch(`${BASE}${route}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(firstHeadingText(html).length).toBeGreaterThan(0);
  });

  // The single assertion that proves the spec's §5.3 reasoning end to end: a PRODUCTION
  // build, given a complete runtime environment, serves real values rather than the
  // markers a build-time bake would have frozen in.
  it.each(CONTENT_ROUTES)("%s contains no unfilled REQUIRED marker", async (route) => {
    expect(await (await fetch(`${BASE}${route}`)).text()).not.toContain("[ REQUIRED:");
  });

  it("redirects / to the default locale", async () => {
    const response = await fetch(`${BASE}/`, { redirect: "manual" });
    expect([307, 308]).toContain(response.status);
    expect(response.headers.get("location")).toContain("/en");
  });

  it("serves robots.txt and sitemap.xml from PUBLIC_BASE_URL, not a hardcoded host", async () => {
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
    expect(robots).toContain("https://smoke.example.test");
    expect(sitemap).toContain("https://smoke.example.test");
    expect(sitemap).not.toContain("filhmar.online");
  });

  it("reports healthy", async () => {
    const body = (await (await fetch(`${BASE}/api/health`)).json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["configComplete"]).toBe(true);
  });

  it("echoes a correlation id", async () => {
    const response = await fetch(`${BASE}/en`, { headers: { "x-request-id": "smoke-1" } });
    expect(response.headers.get("x-request-id")).toBe("smoke-1");
  });
});
