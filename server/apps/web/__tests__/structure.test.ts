import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`;
    if (entry === "node_modules" || entry === ".next") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const EXPECTED_ROUTES = [
  "page.tsx",
  "beta/page.tsx",
  "support/page.tsx",
  "privacy/page.tsx",
  "terms/page.tsx",
  "installed-apps/page.tsx",
  "data-deletion/page.tsx",
] as const;

describe("route inventory", () => {
  it("has exactly the seven locale routes", () => {
    const base = `${WEB_ROOT}app/[locale]`;
    const found = walk(base)
      .filter((file) => file.endsWith("page.tsx"))
      .map((file) => file.slice(base.length + 1).split("\\").join("/"))
      .sort();
    expect(found).toEqual([...EXPECTED_ROUTES].sort());
  });

  it("links every route from both the header and the footer", () => {
    const header = readFileSync(`${WEB_ROOT}components/chrome/site_header.tsx`, "utf8");
    const footer = readFileSync(`${WEB_ROOT}components/chrome/site_footer.tsx`, "utf8");
    for (const key of ["beta", "support", "privacy", "terms", "installed-apps", "data-deletion"]) {
      expect(header).toContain(key);
      // The footer renders NAV_ITEMS imported from the header, so the shared constant is
      // what actually satisfies this. That is the point: two hand-maintained lists drift.
      expect(`${footer}${header}`).toContain(key);
    }
  });

  it("ships the metadata routes a public site is judged on", () => {
    for (const file of ["app/robots.ts", "app/sitemap.ts", "app/api/health/route.ts"]) {
      expect(existsSync(`${WEB_ROOT}${file}`)).toBe(true);
    }
  });

  // Spec §5.3: the boot gate is what stops a container serving a notice with a blank DPO.
  // NEXT_RUNTIME is part of the contract, not an implementation detail: Next compiles this
  // file for the Edge runtime too (proxy.ts runs there), and @peraplano/common writes to
  // process.stdout, which Edge does not have. Without the guard the production build fails.
  it("keeps the production boot gate wired to instrumentation, node-side only", () => {
    const hook = readFileSync(`${WEB_ROOT}instrumentation.ts`, "utf8");
    expect(hook).toContain("export async function register");
    // The hook only delegates. Everything the gate needs — node:fs, process.exit — makes
    // Turbopack warn if it can statically reach it from the Edge compilation of this file.
    expect(hook).toContain("NEXT_RUNTIME");
    expect(hook).toContain("./instrumentation_node");

    const gate = readFileSync(`${WEB_ROOT}instrumentation_node.ts`, "utf8");
    expect(gate).toContain("assertProductionConfig");
    // Throwing out of register() is not enough: Next logs the rejection and keeps
    // listening, so the gate has to end the process itself.
    expect(gate).toContain("process.exit(1)");
  });

  // Next 16 renamed the middleware convention to proxy; the old filename still works but
  // prints a deprecation warning on every production build.
  it("uses the proxy convention rather than the deprecated middleware one", () => {
    expect(existsSync(`${WEB_ROOT}middleware.ts`)).toBe(false);
    const source = readFileSync(`${WEB_ROOT}proxy.ts`, "utf8");
    expect(source).toContain("export function proxy");
    expect(source).toContain("REQUEST_ID_HEADER");
  });
});

describe("hostname discipline", () => {
  // PUBLIC_BASE_URL drives canonical tags, og:url, sitemap.xml and robots.txt. A literal
  // in app/, components/ or messages/ silently wins over the environment on a staging
  // deploy. messages/ is included per the pre-flight ruling: it is exactly where a
  // copywriter would paste a URL, and the plan's original walk missed it.
  it("contains no hostname literal under app/, components/ or messages/", () => {
    const offenders = [
      ...walk(`${WEB_ROOT}app`),
      ...walk(`${WEB_ROOT}components`),
      ...walk(`${WEB_ROOT}messages`),
    ]
      .filter((file) => /\.(ts|tsx|css|json)$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("filhmar.online"));
    expect(offenders).toEqual([]);
  });
});
