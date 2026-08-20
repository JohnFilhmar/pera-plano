# PeraPlano Public Compliance Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six server-rendered public pages at `peraplano.filhmar.online` — marketing, support, privacy, terms, installed-apps, data-deletion — whose legal content is derived from documents already in this repo and tested against them, and whose unfillable legal identifiers cannot be published blank by accident.

**Architecture:** One Next.js 16 App Router app (`server/apps/web`, `output: 'standalone'`) on a two-package npm workspace whose second package (`server/libs/common`) owns env-schema validation, structured logging, correlation IDs and the health report. Copy lives in a typed `messages/en.json` under an `app/[locale]/` segment. Legal identifiers arrive from the environment at runtime, never baked into the image: missing in production aborts boot, missing in dev renders `[ REQUIRED: FIELD ]`. A test parses `docs/07-privacy-and-compliance.md` §4 and asserts the rendered retention table matches it row for row.

**Tech Stack:** Node 22 · Next 16.3.1 (App Router, Turbopack build) · React 19.2.8 · TypeScript 5.9 strict · zod 4.4.3 · Vitest 4.1.11 + `@vitejs/plugin-react` · `react-dom/server` `renderToStaticMarkup` (no jsdom, no RTL) · plain CSS + CSS Modules (no Tailwind) · `next/font/google` (Manrope, self-hosted at build time)

**Spec:** `docs/superpowers/specs/2026-08-20-server-front-facing-pages-design.md`

---

## Global Constraints

Every task's requirements implicitly include these. Values are verbatim; changing one changes the meaning of the work.

- **Working directory for every `npm`/`npx` command is `server/`.** Run one test file with `npx vitest run <path>`; run the fast suite with `npm test`.
- **Nothing legal is invented.** Every sentence of legal or policy consequence traces to a numbered section of a repo document, cited in a source comment on the component that renders it. If no document says it: a *fact* becomes a fail-loud env field; *legal prose needing judgement* becomes a visible on-page "counsel required" block; *product description* comes from `docs/00-product-brief.md` or it does not go on the page.
- **The six fail-loud fields are exactly:** `PIC_LEGAL_NAME`, `PIC_ADDRESS`, `DPO_NAME`, `DPO_EMAIL`, `SUPPORT_EMAIL`, `NPC_REGISTRATION`. Never write a plausible value for any of them, in code, in a test fixture that ships as a default, or in `.env.example`.
- **Marker format is exactly `[ REQUIRED: FIELD_NAME ]`** — one space inside each bracket, field name uppercase. Tests assert this string; do not restyle it.
- **Host port 3003 → container port 3000**, published on `127.0.0.1` only. **Port 5005 is reserved in a comment** for a future PeraPlano backend. Existing box allocation, for the comment: 3000/5000 talyer prod, 3001 fill-main, 3002/5002 genesys prod, 5003 kognita prod, 5004 kognita staging.
- **Domain `peraplano.filhmar.online`** appears in exactly two places: the nginx `server_name`, and `DEFAULT_PUBLIC_BASE_URL` in `libs/common`. **No hostname literal under `apps/web/app/` or `apps/web/components/`** — Task 14 enforces this with a test.
- **`strict: true` everywhere including tests.** Also `noUncheckedIndexedAccess: true`.
- **Zero third-party requests from the published site.** No CDN, no Google Fonts stylesheet link, no analytics, no external image host, no embeds. Fonts are self-hosted via `next/font/google`, which downloads at build time and serves from our origin.
- **Never create, overwrite, copy or delete `.env`, `.env.*`, `*.enc` or any key material.** `server/.env.example` is the only env file this work creates.
- **Design tokens** (light / dark), copied from `docs/pera-plano-web/Landing.dc.html`:
  `brand #15803D / #22C55E` · `brand-2 #22C55E / #4ADE80` · `on-brand #FFFFFF / #06130C` · `mint #DCFCE7 / #14261C` · `bg #F7FAF7 / #0B1210` · `surface #FFFFFF / #111A16` · `text #10201A / #E8F0EC` · `muted #5B6E64 / #9BB0A6` · `danger #DC2626 / #F87171` · `warn #D97706 / #FBBF24` · `line rgba(16,32,26,.12) / rgba(232,240,236,.14)`. PH accents, sparingly: `#0038A8`, `#CE1126`, `#FCD116`.
- **Commit after every task.** Conventional Commits, lower-case imperative subject. **No AI attribution of any kind** — no `Co-Authored-By`, no "Generated with", no footer.
- **Comments explain WHY.** A comment restating the line below it gets deleted in review.

---

## File Structure

**Created — `server/` workspace root**

| File | Responsibility |
|---|---|
| `server/package.json` | Workspace root: `workspaces: ["apps/*","libs/*"]`, `"type":"module"`, all scripts |
| `server/tsconfig.base.json` | The strict flags both packages extend |
| `server/vitest.config.ts` | Fast suite: unit + content + drift |
| `server/vitest.smoke.config.ts` | Slow suite: build, boot the standalone server, fetch every route |
| `server/eslint.config.mjs` | Flat config |
| `server/.env.example` | Every var with a why-comment. No plausible values for the six. |
| `server/.dockerignore` | Excludes `.git`, `node_modules`, `.next`, `*.md`, `.env*` (allows `.env.example`) |
| `server/Dockerfile` | Multi-stage, per-service targets, target `web` |

**Created — `server/libs/common`**

| File | Responsibility |
|---|---|
| `src/config/env.ts` | `COMPLIANCE_FIELDS`, `parseEnvironment`, `requiredMarker`, `assertProductionConfig`, `getConfig`, `MissingComplianceConfigError`, `InvalidConfigError` |
| `src/config/capabilities.ts` | `SERVICE_CAPABILITIES` — the "nothing is on our servers" platform fact |
| `src/logging/logger.ts` | `createLogger` — one JSON line per call, level filter, key-based redaction |
| `src/correlation/request_id.ts` | `REQUEST_ID_HEADER`, `newRequestId`, `readOrCreateRequestId` |
| `src/health/health.ts` | `buildHealthReport` |
| `src/index.ts` | Barrel |
| `src/__tests__/*.test.ts` | One file per module above |

**Created — `server/apps/web`**

| File | Responsibility |
|---|---|
| `next.config.ts` | `output:'standalone'`, `outputFileTracingRoot`, `transpilePackages` |
| `instrumentation.ts` | The production boot gate — the only caller of `assertProductionConfig` |
| `middleware.ts` | Correlation-ID propagation |
| `messages/en.json` | Every word of copy on the site |
| `messages/index.ts` | `SUPPORTED_LOCALES`, `Locale`, `Messages`, `getMessages`, `isSupportedLocale` |
| `app/layout.tsx` | `<html>`, Manrope, `globals.css`, the pre-paint theme script |
| `app/globals.css` | Token block, base element styles, the two brand keyframe sets |
| `app/page.tsx` | `redirect('/en')` |
| `app/robots.ts`, `app/sitemap.ts` | Generated from `PUBLIC_BASE_URL` |
| `app/api/health/route.ts` | Five-line adapter over `buildHealthReport` |
| `app/[locale]/layout.tsx` | `force-dynamic`, locale guard, header + footer |
| `app/[locale]/{,support,privacy,terms,installed-apps,data-deletion}/page.tsx` | Six thin route files |
| `components/chrome/{site_header,site_footer,theme_toggle}.tsx` | Site chrome |
| `components/content/{prose,data_table,callout,contact_block,service_status_notice,counsel_required_notice,brand_mark}.tsx` | Shared primitives |
| `components/pages/{marketing,support,privacy,terms,installed_apps,data_deletion}_page.tsx` | Pure synchronous content components — the testable seam |
| `test_support/markdown_table.ts` | The §4 parser |
| `test_support/html.ts` | `stripTags`, `decodeEntities`, `firstHeadingText`, `extractTable` |
| `test_support/env_fixtures.ts` | `COMPLETE_ENV`, `HOLLOW_ENV` |
| `__tests__/*.test.tsx` | Drift, consistency, tripwire, no-hostname, route inventory, per-page render |
| `public/brand/*`, `public/favicon.ico`, `public/apple-touch-icon.png`, `public/android-chrome-{192x192,512x512}.png`, `public/site.webmanifest` | Brand assets copied from `assets/brand/` |
| `smoke/routes.smoke.test.ts`, `smoke/global_setup.ts` | Task 17 |

**Created — repo root**

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Server-only. Builds `./server`, publishes `127.0.0.1:3003:3000` |
| `docs/nginx/peraplano-production.conf` | HTTP-only site config for the box |
| `.github/workflows/server-ci.yml` | lint · typecheck · test · build · smoke · secret-scan |

**Modified**

| File | Change |
|---|---|
| `.gitignore` | Add `.next/` and `*.tsbuildinfo` (done in Task 1) |

---

## Task 1: Workspace scaffold that builds and boots

**Files:**
- Create: `server/package.json`, `server/tsconfig.base.json`, `server/vitest.config.ts`
- Create: `server/libs/common/package.json`, `server/libs/common/tsconfig.json`, `server/libs/common/src/index.ts`
- Create: `server/apps/web/package.json`, `server/apps/web/tsconfig.json`, `server/apps/web/next.config.ts`
- Create: `server/apps/web/app/layout.tsx`, `server/apps/web/app/page.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the workspace `@peraplano/common` importable from `@peraplano/web` and from Vitest; `npm run build -w @peraplano/web` emitting `.next/standalone/apps/web/server.js`.

**Facts already verified on this machine — do not re-litigate them:**
- `next@16.3.1` builds with Turbopack and **rewrites `tsconfig.json`**: it forces `"jsx": "react-jsx"` and appends `.next/dev/types/**/*.ts` to `include`. Write those values yourself so the first build produces no diff.
- With npm workspaces, standalone output is `.next/standalone/apps/web/server.js` with hoisted `node_modules` at `.next/standalone/node_modules`. The `CMD` is therefore `["node","apps/web/server.js"]`, **not** fill-main's `["node","server.js"]`.
- `instrumentation.ts`'s `register()` runs when the server starts and **does not run during `next build`**. This is what makes Task 2's boot gate possible.
- Vitest needs `"type": "module"` at `server/package.json` (otherwise `vitest.config.ts` loads as CJS and warns), and the `@peraplano/common` alias must go through `fileURLToPath` — `new URL(...).pathname` yields `/D:/...` on Windows and fails to resolve.

- [ ] **Step 1: Write the workspace root `server/package.json`**

```json
{
  "name": "peraplano-server",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["apps/*", "libs/*"],
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "npm run dev -w @peraplano/web",
    "build": "npm run build -w @peraplano/web",
    "start": "node apps/web/.next/standalone/apps/web/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:smoke": "vitest run --config vitest.smoke.config.ts",
    "typecheck": "tsc -p apps/web/tsconfig.json --noEmit && tsc -p libs/common/tsconfig.json --noEmit",
    "lint": "eslint ."
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Write the two package manifests**

`server/libs/common/package.json`:

```json
{
  "name": "@peraplano/common",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.4.3" }
}
```

`server/apps/web/package.json`:

```json
{
  "name": "@peraplano/web",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@peraplano/common": "*",
    "next": "16.3.1",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "~5.9.2"
  }
}
```

- [ ] **Step 4: Write the two package tsconfigs**

`server/libs/common/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["esnext"], "types": ["node"] },
  "include": ["src/**/*.ts"]
}
```

`server/apps/web/tsconfig.json` — note `"jsx": "react-jsx"` and the two `.next` type globs, which Next writes in anyway:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 5: Write `server/apps/web/next.config.ts`**

```ts
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The site is a public compliance surface; advertising the framework version buys
  // an attacker a version-specific exploit list and buys us nothing.
  poweredByHeader: false,
  output: "standalone",
  // Tracing must see the whole npm workspace, not just apps/web, or the standalone
  // bundle ships without the hoisted node_modules and without @peraplano/common.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: ["@peraplano/common"],
};

export default nextConfig;
```

- [ ] **Step 6: Write the placeholder app so the build has something to compile**

`server/apps/web/app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`server/apps/web/app/page.tsx`:

```tsx
export default function Page() {
  return <h1>PeraPlano</h1>;
}
```

`server/libs/common/src/index.ts`:

```ts
export {};
```

- [ ] **Step 7: Write `server/vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: [
      "apps/web/**/__tests__/**/*.test.{ts,tsx}",
      "libs/**/__tests__/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "smoke/**"],
  },
  resolve: {
    alias: {
      // fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/..." and
      // Vite fails to resolve it.
      "@peraplano/common": fileURLToPath(
        new URL("./libs/common/src/index.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./apps/web", import.meta.url)),
    },
  },
});
```

- [ ] **Step 8: Add `.next/` to `.gitignore`**

Under the existing `# server` block:

```
# Next.js build output. `.next/standalone` is a full second copy of node_modules —
# committing it would dwarf the repo and is regenerated by every build anyway.
.next/
*.tsbuildinfo
```

- [ ] **Step 9: Install and prove the build**

Run, from `server/`:

```bash
npm install --no-audit --no-fund
npm install -D --no-audit --no-fund vitest@^4.1.11 @vitejs/plugin-react vite-tsconfig-paths
npm run build -w @peraplano/web
```

Expected: `✓ Compiled successfully`, a route table listing `/`, and no TypeScript errors.

- [ ] **Step 10: Prove the standalone server boots**

```bash
node apps/web/.next/standalone/apps/web/server.js
```
with `PORT=3399 HOSTNAME=127.0.0.1` in the environment, then `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3399/`.

Expected: `Ready`, then `200`. Stop the server.

- [ ] **Step 11: Commit**

```bash
git add server .gitignore
git commit -m "feat(server): npm workspace scaffold for the compliance site"
```

---

## Task 2: Fail-loud configuration

The single most important module in the tier. Read spec §5 before starting.

**Files:**
- Create: `server/libs/common/src/config/env.ts`
- Test: `server/libs/common/src/__tests__/env.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const COMPLIANCE_FIELDS: readonly ["PIC_LEGAL_NAME","PIC_ADDRESS","DPO_NAME","DPO_EMAIL","SUPPORT_EMAIL","NPC_REGISTRATION"];
  type ComplianceField = (typeof COMPLIANCE_FIELDS)[number];
  type ComplianceContacts = Readonly<Record<ComplianceField, string>>;
  type LogLevel = "debug" | "info" | "warn" | "error";
  interface AppConfig {
    readonly nodeEnv: "development" | "test" | "production";
    readonly logLevel: LogLevel;
    readonly publicBaseUrl: string;
    readonly contacts: ComplianceContacts;
  }
  interface EnvParseResult { readonly config: AppConfig; readonly missing: readonly ComplianceField[] }
  function requiredMarker(field: ComplianceField): string;
  function parseEnvironment(raw: Readonly<Record<string, string | undefined>>): EnvParseResult;  // never throws for a missing compliance field
  function assertProductionConfig(result: EnvParseResult): void;                                  // throws MissingComplianceConfigError
  function getConfig(): AppConfig;                                                                 // memoised over process.env
  class MissingComplianceConfigError extends Error { readonly missing: readonly ComplianceField[] }
  class InvalidConfigError extends Error {}
  const DEFAULT_PUBLIC_BASE_URL = "https://peraplano.filhmar.online";
  ```

- [ ] **Step 1: Write the failing tests**

`server/libs/common/src/__tests__/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_FIELDS,
  DEFAULT_PUBLIC_BASE_URL,
  InvalidConfigError,
  MissingComplianceConfigError,
  assertProductionConfig,
  parseEnvironment,
  requiredMarker,
} from "../config/env.js";

const COMPLETE = {
  NODE_ENV: "production",
  PIC_LEGAL_NAME: "Example Controller Inc.",
  PIC_ADDRESS: "1 Example Street, Manila",
  DPO_NAME: "Example Officer",
  DPO_EMAIL: "dpo@example.test",
  SUPPORT_EMAIL: "support@example.test",
  NPC_REGISTRATION: "registration pending",
  PUBLIC_BASE_URL: "https://example.test/",
} as const;

describe("requiredMarker", () => {
  it("uses the exact bracket-and-space format the pages and smoke tests assert", () => {
    expect(requiredMarker("DPO_EMAIL")).toBe("[ REQUIRED: DPO_EMAIL ]");
  });
});

describe("parseEnvironment", () => {
  it("accepts a complete environment with nothing missing", () => {
    const { config, missing } = parseEnvironment(COMPLETE);
    expect(missing).toEqual([]);
    expect(config.contacts.DPO_EMAIL).toBe("dpo@example.test");
    expect(config.nodeEnv).toBe("production");
  });

  it("strips the trailing slash from PUBLIC_BASE_URL so concatenation cannot produce '//'", () => {
    expect(parseEnvironment(COMPLETE).config.publicBaseUrl).toBe("https://example.test");
  });

  it("falls back to the production hostname when PUBLIC_BASE_URL is unset", () => {
    const { config } = parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: undefined });
    expect(config.publicBaseUrl).toBe(DEFAULT_PUBLIC_BASE_URL);
  });

  it("reports every unsupplied compliance field, in declaration order, and marks each value", () => {
    const { config, missing } = parseEnvironment({ NODE_ENV: "development" });
    expect(missing).toEqual([...COMPLIANCE_FIELDS]);
    expect(config.contacts.PIC_LEGAL_NAME).toBe("[ REQUIRED: PIC_LEGAL_NAME ]");
    expect(config.contacts.NPC_REGISTRATION).toBe("[ REQUIRED: NPC_REGISTRATION ]");
  });

  it("marks only the fields that are actually absent", () => {
    const { config, missing } = parseEnvironment({ ...COMPLETE, DPO_EMAIL: undefined });
    expect(missing).toEqual(["DPO_EMAIL"]);
    expect(config.contacts.DPO_EMAIL).toBe("[ REQUIRED: DPO_EMAIL ]");
    expect(config.contacts.DPO_NAME).toBe("Example Officer");
  });

  it("treats a blank or whitespace-only value as absent", () => {
    const { missing } = parseEnvironment({ ...COMPLETE, PIC_ADDRESS: "   " });
    expect(missing).toEqual(["PIC_ADDRESS"]);
  });

  it("treats a malformed email as absent rather than publishing it", () => {
    const { config, missing } = parseEnvironment({ ...COMPLETE, SUPPORT_EMAIL: "not-an-email" });
    expect(missing).toEqual(["SUPPORT_EMAIL"]);
    expect(config.contacts.SUPPORT_EMAIL).toBe("[ REQUIRED: SUPPORT_EMAIL ]");
  });

  it("throws on a malformed PUBLIC_BASE_URL, which is an operator error and not a missing legal fact", () => {
    expect(() => parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: "peraplano.filhmar.online" }))
      .toThrow(InvalidConfigError);
  });

  it("throws on a non-http scheme", () => {
    expect(() => parseEnvironment({ ...COMPLETE, PUBLIC_BASE_URL: "ftp://example.test" }))
      .toThrow(InvalidConfigError);
  });

  it("throws on an unknown LOG_LEVEL rather than silently defaulting", () => {
    expect(() => parseEnvironment({ ...COMPLETE, LOG_LEVEL: "verbose" })).toThrow(InvalidConfigError);
  });
});

describe("assertProductionConfig", () => {
  it("does not throw when nothing is missing", () => {
    expect(() => assertProductionConfig(parseEnvironment(COMPLETE))).not.toThrow();
  });

  it("throws MissingComplianceConfigError naming EVERY missing field, not just the first", () => {
    const result = parseEnvironment({ ...COMPLETE, DPO_EMAIL: undefined, NPC_REGISTRATION: undefined });
    let caught: unknown;
    try {
      assertProductionConfig(result);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MissingComplianceConfigError);
    const err = caught as MissingComplianceConfigError;
    expect(err.missing).toEqual(["DPO_EMAIL", "NPC_REGISTRATION"]);
    expect(err.message).toContain("DPO_EMAIL");
    expect(err.message).toContain("NPC_REGISTRATION");
    expect(err.message).toContain("server/.env.example");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run libs/common/src/__tests__/env.test.ts`
Expected: FAIL — `Failed to resolve import "../config/env.js"`.

- [ ] **Step 3: Write the implementation**

`server/libs/common/src/config/env.ts`:

```ts
import { z } from "zod";

/**
 * The values that appear verbatim in the published privacy notice and support page.
 * As of 2026-08-20 none of them is known. Writing a plausible value for any of them
 * publishes a false legal identifier, which is worse than an outage — see the spec's
 * §5.2 for why the two failure modes below are deliberately different.
 */
export const COMPLIANCE_FIELDS = [
  "PIC_LEGAL_NAME",
  "PIC_ADDRESS",
  "DPO_NAME",
  "DPO_EMAIL",
  "SUPPORT_EMAIL",
  "NPC_REGISTRATION",
] as const;

export type ComplianceField = (typeof COMPLIANCE_FIELDS)[number];
export type ComplianceContacts = Readonly<Record<ComplianceField, string>>;
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Why each field exists, quoted into the boot error so an operator at 2am gets the citation. */
const FIELD_PURPOSE: Readonly<Record<ComplianceField, string>> = {
  PIC_LEGAL_NAME: "legal name of the Personal Information Controller (privacy §2.1, §2.4)",
  PIC_ADDRESS: "registered address of the Controller (privacy §2.4)",
  DPO_NAME: "appointed Data Protection Officer (privacy §2.5)",
  DPO_EMAIL: "Data Protection Officer contact (privacy §2.4, §2.5)",
  SUPPORT_EMAIL: "support mailbox (privacy §2.3; Play listing requirement)",
  NPC_REGISTRATION: "NPC registration status (privacy §2.5)",
};

const EMAIL_FIELDS = new Set<ComplianceField>(["DPO_EMAIL", "SUPPORT_EMAIL"]);

export const DEFAULT_PUBLIC_BASE_URL = "https://peraplano.filhmar.online";

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly logLevel: LogLevel;
  readonly publicBaseUrl: string;
  readonly contacts: ComplianceContacts;
}

export interface EnvParseResult {
  readonly config: AppConfig;
  readonly missing: readonly ComplianceField[];
}

export class InvalidConfigError extends Error {
  override readonly name = "InvalidConfigError";
}

export class MissingComplianceConfigError extends Error {
  override readonly name = "MissingComplianceConfigError";
  readonly missing: readonly ComplianceField[];

  constructor(missing: readonly ComplianceField[]) {
    const lines = missing.map((field) => `  ${field} — ${FIELD_PURPOSE[field]}`).join("\n");
    super(
      `Refusing to start: ${missing.length} required compliance ` +
        `${missing.length === 1 ? "value is" : "values are"} not configured.\n\n${lines}\n\n` +
        "These appear in the published privacy notice. Set them in server/.env.local " +
        "(see server/.env.example) and restart. They are never baked into the image.",
    );
    this.missing = missing;
  }
}

/** The literal a page renders in place of an unsupplied value. Asserted by tests; do not restyle. */
export function requiredMarker(field: ComplianceField): string {
  return `[ REQUIRED: ${field} ]`;
}

const emailSchema = z.email();

const operationalSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function readBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return DEFAULT_PUBLIC_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidConfigError(
      `PUBLIC_BASE_URL is not an absolute URL: ${JSON.stringify(value)}. ` +
        `Expected something like ${DEFAULT_PUBLIC_BASE_URL}.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidConfigError(`PUBLIC_BASE_URL must use http or https, got ${parsed.protocol}`);
  }
  // Strip trailing slashes once, here, so nothing downstream has to remember to.
  return value.replace(/\/+$/, "");
}

/**
 * Pure. NEVER throws for a missing compliance field — that decision belongs to
 * assertProductionConfig, which is called from the server's boot hook only. If this
 * threw, `next build` (which runs with NODE_ENV=production and without the runtime
 * env_file) could not compile the app at all.
 */
export function parseEnvironment(
  raw: Readonly<Record<string, string | undefined>>,
): EnvParseResult {
  const operational = operationalSchema.safeParse({
    NODE_ENV: raw["NODE_ENV"],
    LOG_LEVEL: raw["LOG_LEVEL"],
  });
  if (!operational.success) {
    throw new InvalidConfigError(
      operational.error.issues
        .map((issue) => `${String(issue.path[0])}: ${issue.message}`)
        .join("; "),
    );
  }

  const publicBaseUrl = readBaseUrl(raw["PUBLIC_BASE_URL"]);

  const missing: ComplianceField[] = [];
  const contacts = {} as Record<ComplianceField, string>;
  for (const field of COMPLIANCE_FIELDS) {
    const value = raw[field]?.trim() ?? "";
    // A malformed contact address is not better than an absent one: publishing
    // "dpo@" satisfies a presence check and reaches nobody.
    const usable =
      value !== "" && (!EMAIL_FIELDS.has(field) || emailSchema.safeParse(value).success);
    if (usable) {
      contacts[field] = value;
    } else {
      contacts[field] = requiredMarker(field);
      missing.push(field);
    }
  }

  return {
    config: {
      nodeEnv: operational.data.NODE_ENV,
      logLevel: operational.data.LOG_LEVEL,
      publicBaseUrl,
      contacts,
    },
    missing,
  };
}

/** Called from apps/web/instrumentation.ts only. See the spec's §5.3. */
export function assertProductionConfig(result: EnvParseResult): void {
  if (result.missing.length > 0) throw new MissingComplianceConfigError(result.missing);
}

let cached: AppConfig | undefined;

/**
 * For route files, which run per request. Memoised because process.env does not change
 * after boot; content components take AppConfig as a prop instead, which is what keeps
 * them renderable in a test without touching the environment.
 */
export function getConfig(): AppConfig {
  cached ??= parseEnvironment(process.env).config;
  return cached;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run libs/common/src/__tests__/env.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/libs/common
git commit -m "feat(server): fail-loud compliance config schema"
```

---

## Task 3: The rest of `libs/common` — capabilities, logging, correlation, health

**Files:**
- Create: `server/libs/common/src/config/capabilities.ts`, `src/logging/logger.ts`, `src/correlation/request_id.ts`, `src/health/health.ts`, `src/index.ts`
- Test: `server/libs/common/src/__tests__/{capabilities,logger,request_id,health}.test.ts`

**Interfaces:**
- Consumes: `LogLevel`, `AppConfig` from Task 2.
- Produces:
  ```ts
  const SERVICE_CAPABILITIES: { readonly accounts: false; readonly cloudBackup: false; readonly serverSideStorage: false };
  interface Logger { debug(m: string, f?: LogFields): void; info(...): void; warn(...): void; error(...): void; child(f: LogFields): Logger }
  function createLogger(o: { service: string; level: LogLevel; sink?: (line: string) => void }): Logger;
  const REQUEST_ID_HEADER = "x-request-id";
  function newRequestId(): string;
  function readOrCreateRequestId(h: { get(name: string): string | null }): string;
  interface HealthReport { status: "ok" | "degraded"; service: string; version: string; uptimeSeconds: number; configComplete: boolean }
  function buildHealthReport(i: { service: string; version: string; startedAt: number; now: number; configComplete: boolean }): HealthReport;
  ```

- [ ] **Step 1: Write the failing tests**

`server/libs/common/src/__tests__/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SERVICE_CAPABILITIES } from "../config/capabilities.js";

describe("SERVICE_CAPABILITIES", () => {
  // TRIPWIRE. When any of these flips to true, /privacy and /data-deletion stop being
  // true and this test fails on purpose. Before changing a value here, write:
  //   accounts        -> the real account-deletion route on /data-deletion, plus the
  //                      web deletion link Play's account-deletion policy requires
  //                      (privacy §3.7, 30-day removal commitment)
  //   cloudBackup     -> the recipients section of /privacy naming the backup PIP
  //   serverSideStorage -> everything above, and the ServiceStatusNotice copy
  it("still describes a service that stores nothing", () => {
    expect(SERVICE_CAPABILITIES.accounts).toBe(false);
    expect(SERVICE_CAPABILITIES.cloudBackup).toBe(false);
    expect(SERVICE_CAPABILITIES.serverSideStorage).toBe(false);
  });
});
```

`server/libs/common/src/__tests__/logger.test.ts`:

```ts
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
```

`server/libs/common/src/__tests__/request_id.test.ts`:

```ts
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
```

`server/libs/common/src/__tests__/health.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run libs/common`
Expected: four suites fail to resolve their imports; `env.test.ts` still passes.

- [ ] **Step 3: Write the implementations**

`server/libs/common/src/config/capabilities.ts`:

```ts
/**
 * What this platform actually does today. /privacy and /data-deletion both claim
 * "nothing is stored on our servers"; this constant is the one place that claim is
 * stated, so the two pages cannot drift apart. Flipping any flag fails the tripwire
 * test in __tests__/capabilities.test.ts, which lists what must be written first.
 */
export const SERVICE_CAPABILITIES = {
  accounts: false,
  cloudBackup: false,
  serverSideStorage: false,
} as const;
```

`server/libs/common/src/logging/logger.ts`:

```ts
import type { LogLevel } from "../config/env.js";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Key-name redaction, not value inspection. The one thing that must never reach a log
 * line on this platform is a person's address; matching on the key catches it wherever
 * it is nested without anyone having to remember to strip it at the call site.
 */
const SENSITIVE_KEY = /(password|token|secret|key|email|authorization|cookie)/i;

function redact(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : value;
  }
  return out;
}

export function createLogger(options: {
  service: string;
  level: LogLevel;
  sink?: (line: string) => void;
}): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const threshold = ORDER[options.level];

  const make = (bound: LogFields): Logger => {
    const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
      if (ORDER[level] < threshold) return;
      sink(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          service: options.service,
          msg: message,
          ...redact(bound),
          ...redact(fields ?? {}),
        }),
      );
    };
    return {
      debug: (m, f) => emit("debug", m, f),
      info: (m, f) => emit("info", m, f),
      warn: (m, f) => emit("warn", m, f),
      error: (m, f) => emit("error", m, f),
      child: (f) => make({ ...bound, ...f }),
    };
  };

  return make({});
}
```

`server/libs/common/src/correlation/request_id.ts`:

```ts
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

/** Anything longer or stranger than this is not an id someone upstream meant to send. */
const MAX_LENGTH = 200;
const SAFE = /^[\w.:-]+$/;

export function newRequestId(): string {
  return randomUUID();
}

/**
 * An inbound id is attacker-controllable and ends up in every log line for the request.
 * A newline in it forges a log record; an unbounded one bloats every line. Reject rather
 * than sanitise, so a rejected id is visibly a fresh one instead of a mangled original.
 */
export function readOrCreateRequestId(headers: { get(name: string): string | null }): string {
  const inbound = headers.get(REQUEST_ID_HEADER);
  if (inbound !== null && inbound.length > 0 && inbound.length <= MAX_LENGTH && SAFE.test(inbound)) {
    return inbound;
  }
  return newRequestId();
}
```

`server/libs/common/src/health/health.ts`:

```ts
export interface HealthReport {
  readonly status: "ok" | "degraded";
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly configComplete: boolean;
}

/**
 * configComplete is a boolean and never a field list. The names are not secret — they
 * are meant to be published — but a public endpoint enumerating what the operator has
 * not finished is free reconnaissance for no benefit. The names go to the log, at boot.
 */
export function buildHealthReport(input: {
  service: string;
  version: string;
  startedAt: number;
  now: number;
  configComplete: boolean;
}): HealthReport {
  return {
    status: input.configComplete ? "ok" : "degraded",
    service: input.service,
    version: input.version,
    uptimeSeconds: Math.floor((input.now - input.startedAt) / 1000),
    configComplete: input.configComplete,
  };
}
```

`server/libs/common/src/index.ts`:

```ts
export * from "./config/env.js";
export * from "./config/capabilities.js";
export * from "./logging/logger.js";
export * from "./correlation/request_id.js";
export * from "./health/health.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run libs/common`
Expected: PASS, 5 files.

- [ ] **Step 5: Commit**

```bash
git add server/libs/common
git commit -m "feat(server): platform library capabilities, logging, correlation and health"
```

---

## Task 4: Message catalog, typed loader, locale routing

**Files:**
- Create: `server/apps/web/messages/en.json`, `server/apps/web/messages/index.ts`
- Modify: `server/apps/web/app/page.tsx`
- Create: `server/apps/web/app/[locale]/layout.tsx`, `server/apps/web/app/[locale]/page.tsx`
- Test: `server/apps/web/__tests__/messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const SUPPORTED_LOCALES: readonly ["en"];
  type Locale = "en";
  type Messages = typeof enMessages;      // structural type derived from the JSON
  function isSupportedLocale(value: string): value is Locale;
  function getMessages(locale: Locale): Messages;
  ```
- Later tasks add keys to `en.json`. The top-level shape is fixed here so they do not fight over it:
  `meta`, `nav`, `footer`, `serviceStatus`, `counselRequired`, `marketing`, `support`, `privacy`, `terms`, `installedApps`, `dataDeletion`.

- [ ] **Step 1: Write the failing test**

`server/apps/web/__tests__/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, getMessages, isSupportedLocale } from "../messages/index.js";

describe("message catalog", () => {
  it("ships exactly one locale, so no language switcher may render yet", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en"]);
  });

  it("accepts a supported locale and rejects anything else", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fil")).toBe(false);
    expect(isSupportedLocale("../../etc/passwd")).toBe(false);
  });

  it("exposes every top-level section the six pages need", () => {
    const m = getMessages("en");
    for (const section of [
      "meta",
      "nav",
      "footer",
      "serviceStatus",
      "counselRequired",
      "marketing",
      "support",
      "privacy",
      "terms",
      "installedApps",
      "dataDeletion",
    ]) {
      expect(m).toHaveProperty(section);
    }
  });

  it("carries the product tagline verbatim from the brief §2", () => {
    expect(getMessages("en").meta.tagline).toBe(
      "You never log a transaction; you only set the rules.",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/web/__tests__/messages.test.ts`
Expected: FAIL — cannot resolve `../messages/index.js`.

- [ ] **Step 3: Write `messages/en.json` with the skeleton and the chrome copy**

Later tasks fill the six page sections. Create every top-level key now with the chrome content complete:

```json
{
  "meta": {
    "siteName": "PeraPlano",
    "tagline": "You never log a transaction; you only set the rules.",
    "description": "PeraPlano is a Philippines-first Android app that tracks your money automatically by reading the notifications your banks and e-wallets already send you — on your phone, never on a server.",
    "locale": "en",
    "localeLabel": "English"
  },
  "nav": {
    "home": "Home",
    "support": "Support",
    "privacy": "Privacy",
    "terms": "Terms",
    "installedApps": "Installed apps",
    "dataDeletion": "Delete your data",
    "skipToContent": "Skip to content",
    "toggleTheme": "Toggle dark mode"
  },
  "footer": {
    "promise": "Local-first · No ads · Your data is never sold",
    "controllerHeading": "Personal Information Controller",
    "dpoHeading": "Data Protection Officer",
    "npcHeading": "NPC registration",
    "supportHeading": "Support",
    "copyright": "© 2026 PeraPlano"
  },
  "serviceStatus": { "heading": "", "paragraphs": [] },
  "counselRequired": { "heading": "", "intro": "", "clauses": [], "consequence": "" },
  "marketing": {},
  "support": {},
  "privacy": {},
  "terms": {},
  "installedApps": {},
  "dataDeletion": {}
}
```

- [ ] **Step 4: Write `messages/index.ts`**

```ts
import en from "./en.json" with { type: "json" };

/**
 * One locale today. The [locale] route segment and this list exist now so that adding
 * Filipino is a file drop plus one array entry, rather than moving every route file and
 * rewriting every internal link at the moment a translation is being legally reviewed.
 */
export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Derived from the English catalog, so `fil.json satisfies Messages` turns a missing
 * translation key into a TypeScript error instead of a runtime fallback nobody notices.
 */
export type Messages = typeof en;

const CATALOGS: Readonly<Record<Locale, Messages>> = { en };

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}
```

If the `with { type: "json" }` import attribute is rejected by the Next or Vitest transform, fall back to plain `import en from "./en.json";` — `resolveJsonModule` is already on. Do not add a runtime JSON reader; the compile-time type is the whole point.

- [ ] **Step 5: Write the routing shell**

`server/apps/web/app/page.tsx` — replace the placeholder:

```tsx
import { redirect } from "next/navigation";
import { SUPPORTED_LOCALES } from "@/messages/index.js";

// Permanent, not temporary: /en is the canonical home and a 307 would leave search
// engines and Play's crawler indexing a bare "/" that only ever bounces.
export default function RootPage(): never {
  redirect(`/${SUPPORTED_LOCALES[0]}`);
}
```

`server/apps/web/app/[locale]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getConfig } from "@peraplano/common";
import { SUPPORTED_LOCALES, getMessages, isSupportedLocale } from "@/messages/index.js";

/**
 * Every page under this segment renders the DPO and support contact in the footer, and
 * those values arrive from the environment at RUNTIME (see the spec's §5.3). Prerendering
 * this subtree would bake the dev "[ REQUIRED: … ]" markers into the image, which a
 * correctly configured production container would then happily serve. Do not remove this.
 */
export const dynamic = "force-dynamic";

export function generateStaticParams(): { locale: string }[] {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const messages = getMessages(locale);
  const config = getConfig();
  return (
    <>
      {/* SiteHeader and SiteFooter arrive in Task 5. */}
      <main id="content">{children}</main>
      <span hidden data-locale={locale} data-base-url={config.publicBaseUrl}>
        {messages.meta.siteName}
      </span>
    </>
  );
}
```

`server/apps/web/app/[locale]/page.tsx`:

```tsx
import { getMessages } from "@/messages/index.js";

export default async function HomePage({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <h1>{getMessages(locale).meta.siteName}</h1>;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run apps/web/__tests__/messages.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify the app still builds and `/` redirects**

Run: `npm run build -w @peraplano/web`
Expected: route table lists `/`, `/[locale]`. Boot the standalone server and check
`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3399/` returns `308`, and `/en` returns `200`.

- [ ] **Step 8: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): typed message catalog and locale routing"
```

---

## Task 5: Visual system — tokens, chrome, brand assets

**Files:**
- Create: `server/apps/web/app/globals.css`
- Modify: `server/apps/web/app/layout.tsx`, `server/apps/web/app/[locale]/layout.tsx`
- Create: `server/apps/web/components/chrome/site_header.tsx`, `site_footer.tsx`, `theme_toggle.tsx`
- Create: `server/apps/web/components/content/brand_mark.tsx`
- Create: `server/apps/web/public/…` (copied brand assets), `server/apps/web/public/site.webmanifest`
- Test: `server/apps/web/__tests__/chrome.test.tsx`

**Interfaces:**
- Consumes: `Messages` (Task 4), `AppConfig` (Task 2).
- Produces:
  ```tsx
  function BrandMark(props: { size?: number; animated?: boolean }): JSX.Element;
  function SiteHeader(props: { messages: Messages; locale: Locale; localeCount: number }): JSX.Element;
  function SiteFooter(props: { messages: Messages; contacts: ComplianceContacts; locale: Locale }): JSX.Element;
  ```

**Asset facts from `assets/brand/README.md` — do not rediscover them:**
- `peraplano-logo-animated.svg` **contains no animation.** Its ids `#trail` and `#plane` are targets for CSS the web front end supplies. It must be **inlined into the DOM** (hence `BrandMark` is hand-written JSX, not an `<img>`), or our CSS cannot reach the ids.
- `favicon/site.webmanifest` ships with empty `name`/`short_name` and `theme_color:#ffffff`. Rewrite it; do not copy it.
- `nav/*.svg` have no consumer on this site. Do not copy them in.
- Brand hexes: light face `#22C55E`, shadow face `#15803D`.

- [ ] **Step 1: Write the failing test**

`server/apps/web/__tests__/chrome.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/chrome/site_footer.js";
import { SiteHeader } from "@/components/chrome/site_header.js";
import { getMessages } from "@/messages/index.js";
import { COMPLETE_CONTACTS, HOLLOW_CONTACTS } from "@/test_support/env_fixtures.js";

const messages = getMessages("en");

describe("SiteHeader", () => {
  it("links every one of the six pages", () => {
    const html = renderToStaticMarkup(
      <SiteHeader messages={messages} locale="en" localeCount={1} />,
    );
    for (const path of ["/en", "/en/support", "/en/privacy", "/en/terms", "/en/installed-apps", "/en/data-deletion"]) {
      expect(html).toContain(`href="${path}"`);
    }
  });

  it("renders no language switcher while only one locale exists", () => {
    const html = renderToStaticMarkup(
      <SiteHeader messages={messages} locale="en" localeCount={1} />,
    );
    expect(html).not.toContain("data-language-switcher");
  });
});

describe("SiteFooter", () => {
  it("publishes the controller, DPO, NPC and support contacts", () => {
    const html = renderToStaticMarkup(
      <SiteFooter messages={messages} contacts={COMPLETE_CONTACTS} locale="en" />,
    );
    expect(html).toContain(COMPLETE_CONTACTS.PIC_LEGAL_NAME);
    expect(html).toContain(COMPLETE_CONTACTS.DPO_EMAIL);
    expect(html).toContain(COMPLETE_CONTACTS.NPC_REGISTRATION);
    expect(html).toContain(`mailto:${COMPLETE_CONTACTS.SUPPORT_EMAIL}`);
  });

  it("shows the unfilled marker verbatim when a contact is not configured", () => {
    const html = renderToStaticMarkup(
      <SiteFooter messages={messages} contacts={HOLLOW_CONTACTS} locale="en" />,
    );
    expect(html).toContain("[ REQUIRED: DPO_EMAIL ]");
  });
});
```

- [ ] **Step 2: Write the shared env fixtures the test imports**

`server/apps/web/test_support/env_fixtures.ts`:

```ts
import { COMPLIANCE_FIELDS, parseEnvironment } from "@peraplano/common";
import type { AppConfig, ComplianceContacts } from "@peraplano/common";

/**
 * Deliberately obvious fakes on the .test TLD (RFC 2606). Nothing here may ever look
 * like a real contact — a plausible fixture is one careless copy/paste away from being
 * the value that ships in .env.example and then in the published notice.
 */
export const COMPLETE_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "production",
  PIC_LEGAL_NAME: "Example Controller Inc.",
  PIC_ADDRESS: "1 Example Street, Manila",
  DPO_NAME: "Example Officer",
  DPO_EMAIL: "dpo@example.test",
  SUPPORT_EMAIL: "support@example.test",
  NPC_REGISTRATION: "registration pending",
  PUBLIC_BASE_URL: "https://example.test",
};

export const HOLLOW_ENV: Readonly<Record<string, string>> = { NODE_ENV: "development" };

export const COMPLETE_CONFIG: AppConfig = parseEnvironment(COMPLETE_ENV).config;
export const HOLLOW_CONFIG: AppConfig = parseEnvironment(HOLLOW_ENV).config;
export const COMPLETE_CONTACTS: ComplianceContacts = COMPLETE_CONFIG.contacts;
export const HOLLOW_CONTACTS: ComplianceContacts = HOLLOW_CONFIG.contacts;
export const ALL_COMPLIANCE_FIELDS = COMPLIANCE_FIELDS;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/web/__tests__/chrome.test.tsx`
Expected: FAIL — cannot resolve `@/components/chrome/site_header.js`.

- [ ] **Step 4: Copy the brand assets into `public/`**

From the repo root, copy — do not move, `assets/brand/` stays canonical:

| From | To |
|---|---|
| `assets/brand/favicon/favicon.ico` | `server/apps/web/public/favicon.ico` |
| `assets/brand/favicon/favicon-16x16.png` | `server/apps/web/public/favicon-16x16.png` |
| `assets/brand/favicon/favicon-32x32.png` | `server/apps/web/public/favicon-32x32.png` |
| `assets/brand/favicon/apple-touch-icon.png` | `server/apps/web/public/apple-touch-icon.png` |
| `assets/brand/favicon/android-chrome-192x192.png` | `server/apps/web/public/android-chrome-192x192.png` |
| `assets/brand/favicon/android-chrome-512x512.png` | `server/apps/web/public/android-chrome-512x512.png` |
| `assets/brand/favicon/peraplano-favicon.svg` | `server/apps/web/public/brand/peraplano-favicon.svg` |
| `assets/brand/peraplano-logo-static.svg` | `server/apps/web/public/brand/peraplano-logo-static.svg` |
| `assets/brand/peraplano-bg-planes.svg` | `server/apps/web/public/brand/peraplano-bg-planes.svg` |

Then write `server/apps/web/public/site.webmanifest` (the delivered one has empty names and a white theme colour against a green brand):

```json
{
  "name": "PeraPlano",
  "short_name": "PeraPlano",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#15803D",
  "background_color": "#F7FAF7",
  "display": "standalone"
}
```

- [ ] **Step 5: Write `app/globals.css`**

Token block copied verbatim from `docs/pera-plano-web/Landing.dc.html`. Three things it must do that the canvas does not:

1. define the dark palette under **both** `@media (prefers-color-scheme: dark)` (guarded with `:root:not([data-theme="light"])`) **and** `:root[data-theme="dark"]`, so the toggle wins in both directions and the no-JS default still tracks the OS;
2. wrap the two brand keyframe animations in `@media (prefers-reduced-motion: no-preference)`;
3. give wide tables their own `overflow-x: auto` container — privacy §4's table is six columns of prose and the page body must never scroll sideways.

```css
:root {
  color-scheme: light;
  --brand: #15803d;
  --brand-2: #22c55e;
  --on-brand: #ffffff;
  --mint: #dcfce7;
  --bg: #f7faf7;
  --surface: #ffffff;
  --text: #10201a;
  --muted: #5b6e64;
  --danger: #dc2626;
  --warn: #d97706;
  --line: rgba(16, 32, 26, 0.12);
  --ph-blue: #0038a8;
  --ph-red: #ce1126;
  --ph-yellow: #fcd116;
  --shadow: 0 24px 60px -24px rgba(16, 32, 26, 0.28);
  --measure: 1120px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --brand: #22c55e;
    --brand-2: #4ade80;
    --on-brand: #06130c;
    --mint: #14261c;
    --bg: #0b1210;
    --surface: #111a16;
    --text: #e8f0ec;
    --muted: #9bb0a6;
    --danger: #f87171;
    --warn: #fbbf24;
    --line: rgba(232, 240, 236, 0.14);
    --shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.6);
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --brand: #22c55e;
  --brand-2: #4ade80;
  --on-brand: #06130c;
  --mint: #14261c;
  --bg: #0b1210;
  --surface: #111a16;
  --text: #e8f0ec;
  --muted: #9bb0a6;
  --danger: #f87171;
  --warn: #fbbf24;
  --line: rgba(232, 240, 236, 0.14);
  --shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.6);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-manrope), system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  line-height: 1.65;
  text-wrap: pretty;
}

a { color: var(--brand); text-underline-offset: 0.2em; }
a:hover { color: var(--brand-2); }

h1, h2, h3 { line-height: 1.2; letter-spacing: -0.015em; text-wrap: balance; }

/* A six-column prose table cannot fit a phone. It scrolls inside its own box so the
   page body never scrolls sideways — the most common way a content site breaks. */
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.table-scroll table { border-collapse: collapse; width: 100%; min-width: 46rem; }
.table-scroll th, .table-scroll td {
  border: 1px solid var(--line);
  padding: 0.6rem 0.75rem;
  text-align: left;
  vertical-align: top;
  font-size: 0.925rem;
}
.table-scroll th { background: var(--mint); font-weight: 700; }

/* The delivered peraplano-logo-animated.svg carries no animation of its own — its
   #plane and #trail ids exist so the web front end can drive them, which is what these
   two keyframe sets do. Motion is opt-in by OS preference. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes pp-float {
    0%, 100% { transform: translateY(2.5px) rotate(-1.6deg); }
    50% { transform: translateY(-3.5px) rotate(2deg); }
  }
  @keyframes pp-flow { to { stroke-dashoffset: -2.22; } }
  .brand-mark--animated #plane { animation: pp-float 4.2s ease-in-out infinite; transform-origin: 12px 12px; }
  .brand-mark--animated #trail { animation: pp-flow 1.8s linear infinite; }
}

.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 1rem;
  top: 1rem;
  z-index: 100;
  background: var(--surface);
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
}
```

- [ ] **Step 6: Write `components/content/brand_mark.tsx`**

```tsx
/**
 * Hand-written rather than an <img>: assets/brand/peraplano-logo-animated.svg ships with
 * no animation, only the stable ids #plane and #trail for the web front end's CSS to
 * drive. An <img> puts those ids in a separate document our stylesheet cannot reach.
 * Geometry is copied verbatim from that file; brand hexes come from assets/brand/README.md.
 */
export function BrandMark({ size = 26, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="PeraPlano"
      className={animated ? "brand-mark--animated" : undefined}
    >
      <path
        id="trail"
        d="M2.6 21.4 C 6 21 8.6 18.4 10.2 14.2"
        fill="none"
        stroke="var(--brand-2)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="0.12 2.1"
        opacity="0.55"
      />
      <g id="plane">
        <path d="M22 2 L2 9 L11 13 Z" fill="var(--brand-2)" />
        <path d="M22 2 L11 13 L15 22 Z" fill="var(--brand)" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 7: Write the header, footer and theme toggle**

`components/chrome/theme_toggle.tsx` — a client component, the only one on the site:

```tsx
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pp-theme";

/**
 * The stored preference is applied by a blocking script in <head> (see app/layout.tsx),
 * not here — this component only flips it afterwards. Doing it in React alone would
 * paint the light theme first and then swap, which on a dark device reads as broken.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-browsing modes reject writes. The toggle still works for this page view;
      // losing the preference is not worth a thrown error on a compliance page.
    }
    setTheme(next);
  };

  return (
    <button type="button" onClick={flip} aria-label={label} data-theme-toggle>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
```

`components/chrome/site_header.tsx` — sticky, translucent, `max-width: var(--measure)`, inline `BrandMark` at 26px, the six nav links built from a `NAV_ITEMS` array (path suffix + `nav` message key), the toggle, and a skip link. `localeCount > 1` is the only condition under which a `data-language-switcher` element renders; with one locale it renders nothing.

`components/chrome/site_footer.tsx` — the six links again, then four contact blocks (controller: `PIC_LEGAL_NAME` + `PIC_ADDRESS`; DPO: `DPO_NAME` + `DPO_EMAIL` as a `mailto:`; NPC: `NPC_REGISTRATION`; support: `SUPPORT_EMAIL` as a `mailto:`), then `footer.copyright` and `footer.promise`.

Both use CSS Modules (`site_header.module.css`, `site_footer.module.css`) referencing only the tokens.

- [ ] **Step 8: Wire the chrome into the layouts**

`app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Self-hosted: next/font downloads at build time and serves from our own origin, so a
// visitor to the privacy notice makes zero third-party requests while reading a page
// that claims there are no third-party recipients.
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/brand/peraplano-favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

// Applied before first paint; a React-only toggle flashes the light theme first.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('pp-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

`app/[locale]/layout.tsx` — replace the Task 4 stub body with `<SiteHeader …/>`, `<main id="content">{children}</main>`, `<SiteFooter …/>`, passing `localeCount={SUPPORTED_LOCALES.length}` and `contacts={getConfig().contacts}`.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run apps/web/__tests__/chrome.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 10: Verify the build**

Run: `npm run build -w @peraplano/web`
Expected: compiles; the route table shows `/[locale]` as `ƒ (Dynamic)`.

- [ ] **Step 11: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): design tokens, site chrome and brand assets"
```

---

## Task 6: Shared content primitives

**Files:**
- Create: `server/apps/web/components/content/prose.tsx`, `data_table.tsx`, `callout.tsx`, `contact_block.tsx`, `service_status_notice.tsx`, `counsel_required_notice.tsx` (+ their `.module.css`)
- Test: `server/apps/web/__tests__/content_primitives.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  interface Section { readonly heading: string; readonly paragraphs?: readonly string[]; readonly bullets?: readonly string[] }
  function Prose(props: { sections: readonly Section[] }): JSX.Element;
  function DataTable(props: { id: string; caption: string; headers: readonly string[]; rows: readonly (readonly string[])[] }): JSX.Element;
  function Callout(props: { tone: "info" | "warn" | "danger"; heading: string; children: React.ReactNode }): JSX.Element;
  function ContactBlock(props: { heading: string; lines: readonly string[]; mailto?: string }): JSX.Element;
  function ServiceStatusNotice(props: { messages: Messages }): JSX.Element;
  function CounselRequiredNotice(props: { messages: Messages }): JSX.Element;
  ```
- `DataTable` renders `<table data-table-id={id}>`. **Task 8's drift test finds the lifecycle table by `data-table-id="lifecycle"`** — the attribute name and the id are load-bearing.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "@/components/content/data_table.js";
import { ServiceStatusNotice } from "@/components/content/service_status_notice.js";
import { getMessages } from "@/messages/index.js";

describe("DataTable", () => {
  it("tags the table with the id the drift test looks for", () => {
    const html = renderToStaticMarkup(
      <DataTable id="lifecycle" caption="c" headers={["a", "b"]} rows={[["1", "2"]]} />,
    );
    expect(html).toContain('data-table-id="lifecycle"');
  });

  it("wraps the table so a six-column prose table cannot make the page scroll sideways", () => {
    const html = renderToStaticMarkup(
      <DataTable id="x" caption="c" headers={["a"]} rows={[["1"]]} />,
    );
    expect(html).toContain("table-scroll");
  });

  it("renders every header and every cell", () => {
    const html = renderToStaticMarkup(
      <DataTable id="x" caption="c" headers={["H1", "H2"]} rows={[["r1c1", "r1c2"], ["r2c1", "r2c2"]]} />,
    );
    for (const text of ["H1", "H2", "r1c1", "r1c2", "r2c1", "r2c2"]) {
      expect(html).toContain(text);
    }
  });
});

describe("ServiceStatusNotice", () => {
  it("states plainly that there is no server-side copy", () => {
    const html = renderToStaticMarkup(<ServiceStatusNotice messages={getMessages("en")} />);
    expect(html).toContain("no copy on our servers");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/__tests__/content_primitives.test.tsx`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Fill the `serviceStatus` and `counselRequired` catalog entries**

In `messages/en.json`, replace the two empty stubs. `serviceStatus` derives from the owner's scope statement plus `SERVICE_CAPABILITIES`:

```json
"serviceStatus": {
  "heading": "What PeraPlano runs today",
  "paragraphs": [
    "PeraPlano is an Android app. It has no sign-in, no user accounts, and no multi-device sync.",
    "Everything the app records lives in an encrypted database on your own phone. There is no copy on our servers to look at, to hand over, or to delete.",
    "Cloud backup and multi-device sync are described in our planning documents as future PeraPlano Plus features. They are not available, and no part of your ledger is transmitted anywhere today."
  ]
},
"counselRequired": {
  "heading": "Clauses a lawyer still has to write",
  "intro": "These terms are incomplete, and we would rather say so than publish something that looks finished. The following have not been drafted:",
  "clauses": [
    "Governing law and venue.",
    "Limitation of liability and warranty disclaimer, including for an inaccurate parse.",
    "Subscription term, renewal, cancellation and refund terms.",
    "Intellectual property, and the licence granted to you when you install the app.",
    "Termination and suspension.",
    "How changes to these terms are notified, and when they take effect.",
    "The effective date of this document."
  ],
  "consequence": "PeraPlano Plus cannot be offered for sale until these exist."
}
```

- [ ] **Step 4: Write the six components**

`data_table.tsx` is the load-bearing one:

```tsx
import styles from "./data_table.module.css";

export function DataTable({
  id,
  caption,
  headers,
  rows,
}: {
  id: string;
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    // data-table-id is how the §4 drift test finds this table in the rendered HTML.
    // Renaming it silently disables the test that keeps the notice honest.
    <div className={`table-scroll ${styles.wrap}`}>
      <table data-table-id={id}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.join("|") + String(rowIndex)}>
              {row.map((cell, cellIndex) => (
                <td key={`${String(rowIndex)}-${String(cellIndex)}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`prose.tsx` renders `<section><h2>{heading}</h2>` then each paragraph as `<p>` and, if present, `bullets` as a `<ul>`. `callout.tsx` renders an aside with a tone class mapping to `--mint` / `--warn` / `--danger` borders. `contact_block.tsx` renders `<h3>` + lines, with the last line wrapped in a `mailto:` anchor when `mailto` is given. `service_status_notice.tsx` and `counsel_required_notice.tsx` render their catalog sections inside a `Callout` (`tone="info"` and `tone="warn"` respectively).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run apps/web/__tests__/content_primitives.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): shared content primitives for the compliance pages"
```

---

## Task 7: The markdown table parser

**Files:**
- Create: `server/apps/web/test_support/markdown_table.ts`, `server/apps/web/test_support/html.ts`
- Test: `server/apps/web/__tests__/markdown_table.test.ts`, `server/apps/web/__tests__/html_support.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface MarkdownTable { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] }
  function extractSection(markdown: string, headingLine: string): string;
  function splitRow(line: string): string[];
  function normalizeCell(raw: string): string;
  function parseFirstTable(section: string): MarkdownTable;
  function extractStatusLine(markdown: string): string;
  // html.ts
  function decodeEntities(html: string): string;
  function stripTags(html: string): string;
  function firstHeadingText(html: string): string;
  function extractTable(html: string, tableId: string): MarkdownTable;
  ```

- [ ] **Step 1: Write the failing tests**

`server/apps/web/__tests__/markdown_table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  extractSection,
  extractStatusLine,
  normalizeCell,
  parseFirstTable,
  splitRow,
} from "@/test_support/markdown_table.js";

describe("splitRow", () => {
  it("splits on unescaped pipes and drops the leading and trailing empties", () => {
    expect(splitRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });

  // Privacy §4 row 4 contains `tier: free \| plus`. A naive String.split('|') passes
  // every other row in the table and silently corrupts this one.
  it("keeps an escaped pipe inside its cell", () => {
    expect(splitRow("| 4 | tier: free \\| plus | on-device |")).toEqual([
      "4",
      "tier: free \\| plus",
      "on-device",
    ]);
  });
});

describe("normalizeCell", () => {
  it("strips bold", () => {
    expect(normalizeCell("**30-day TTL, then purged**")).toBe("30-day TTL, then purged");
  });
  it("strips backticks", () => {
    expect(normalizeCell("`rawNotificationRef`")).toBe("rawNotificationRef");
  });
  it("keeps link text and drops the repo-relative target", () => {
    expect(normalizeCell("see [08-risks-and-open-questions.md](08-risks-and-open-questions.md)")).toBe(
      "see 08-risks-and-open-questions.md",
    );
  });
  it("unescapes an escaped pipe", () => {
    expect(normalizeCell("tier: free \\| plus")).toBe("tier: free | plus");
  });
  it("collapses runs of whitespace", () => {
    expect(normalizeCell("  a   b  ")).toBe("a b");
  });
});

describe("extractSection", () => {
  const doc = "# T\n\n## 3. A\n\nalpha\n\n## 4. Data lifecycle\n\nbeta\n\n## 5. B\n\ngamma\n";

  it("returns only the requested section", () => {
    const section = extractSection(doc, "## 4. Data lifecycle");
    expect(section).toContain("beta");
    expect(section).not.toContain("alpha");
    expect(section).not.toContain("gamma");
  });

  it("throws and names the headings it found, so a renamed heading is not a silent pass", () => {
    expect(() => extractSection(doc, "## 4. Data lifecycles")).toThrow(/## 4\. Data lifecycle/);
  });
});

describe("parseFirstTable", () => {
  it("reads headers and rows and ignores the alignment row", () => {
    const table = parseFirstTable("text\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nmore");
    expect(table.headers).toEqual(["A", "B"]);
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("throws when the section has no table, rather than returning an empty one", () => {
    expect(() => parseFirstTable("just prose")).toThrow(/no markdown table/i);
  });
});

describe("extractStatusLine", () => {
  it("pulls the document's own status line so a page cannot claim a freshness it lacks", () => {
    expect(extractStatusLine("# T\n\n**Status:** Draft v1 · 2026-08-02\n\n---\n")).toBe(
      "Draft v1 · 2026-08-02",
    );
  });
});
```

`server/apps/web/__tests__/html_support.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeEntities, extractTable, firstHeadingText, stripTags } from "@/test_support/html.js";

describe("html test support", () => {
  it("decodes the five entities React escapes", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#x27;")).toBe(
      `a & b <c> "d" 'e'`,
    );
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<p>a <strong>b</strong>\n  c</p>")).toBe("a b c");
  });

  it("finds the first heading's text", () => {
    expect(firstHeadingText('<div><h1 class="x">Privacy <em>notice</em></h1></div>')).toBe(
      "Privacy notice",
    );
  });

  it("extracts a table by its data-table-id and ignores every other table", () => {
    const html =
      '<table data-table-id="other"><tbody><tr><td>no</td></tr></tbody></table>' +
      '<table data-table-id="lifecycle"><caption>c</caption>' +
      "<thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>1</td><td>2 &amp; 3</td></tr></tbody></table>";
    expect(extractTable(html, "lifecycle")).toEqual({
      headers: ["A", "B"],
      rows: [["1", "2 & 3"]],
    });
  });

  it("throws when the table id is absent, so a renamed table cannot pass vacuously", () => {
    expect(() => extractTable("<p>nothing</p>", "lifecycle")).toThrow(/lifecycle/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/__tests__/markdown_table.test.ts apps/web/__tests__/html_support.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Write `test_support/markdown_table.ts`**

```ts
export interface MarkdownTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Walks the line tracking backslash escapes instead of calling String.split('|').
 * Privacy §4 row 4 contains `tier: free \| plus`; a naive split passes every other row
 * in that table and quietly turns one row into two cells.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      current += char + String(line[i + 1]);
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char ?? "";
  }
  cells.push(current);
  // "| a | b |" yields a leading and a trailing empty cell.
  if (cells.length > 0 && cells[0]?.trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

export function normalizeCell(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link text only; the target is a repo path
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSection(markdown: string, headingLine: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) {
    const found = lines.filter((line) => line.startsWith("## ")).join("\n  ");
    throw new Error(
      `extractSection: heading ${JSON.stringify(headingLine)} not found. ` +
        `Headings present:\n  ${found}`,
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

export function parseFirstTable(section: string): MarkdownTable {
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const headerIndex = lines.findIndex(
    (line, index) =>
      line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[index + 1] ?? ""),
  );
  if (headerIndex === -1) {
    throw new Error("parseFirstTable: no markdown table found in the given section");
  }
  const headers = splitRow(lines[headerIndex] ?? "").map(normalizeCell);
  const rows: string[][] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(splitRow(line).map(normalizeCell));
  }
  return { headers, rows };
}

export function extractStatusLine(markdown: string): string {
  const match = /^\*\*Status:\*\*\s*(.+)$/m.exec(markdown);
  if (match?.[1] === undefined) {
    throw new Error("extractStatusLine: no '**Status:**' line found");
  }
  return match[1].trim();
}
```

- [ ] **Step 4: Write `test_support/html.ts`**

```ts
import type { MarkdownTable } from "./markdown_table.js";

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

export function decodeEntities(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (match) => ENTITIES[match] ?? match);
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function firstHeadingText(html: string): string {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (match?.[1] === undefined) throw new Error("firstHeadingText: no <h1> in the rendered HTML");
  return stripTags(match[1]);
}

/**
 * Deliberately throws rather than returning an empty table: a renamed data-table-id must
 * fail the drift test loudly, not turn it into a comparison of two empty arrays.
 */
export function extractTable(html: string, tableId: string): MarkdownTable {
  const pattern = new RegExp(
    `<table\\b[^>]*data-table-id="${tableId}"[^>]*>([\\s\\S]*?)</table>`,
    "i",
  );
  const match = pattern.exec(html);
  if (match?.[1] === undefined) {
    throw new Error(`extractTable: no <table data-table-id="${tableId}"> in the rendered HTML`);
  }
  const body = match[1];
  const rowMatches = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const parsed = rowMatches.map((row) =>
    [...(row[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
      stripTags(cell[2] ?? ""),
    ),
  );
  const [headers, ...rows] = parsed;
  return { headers: headers ?? [], rows };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run apps/web/__tests__/markdown_table.test.ts apps/web/__tests__/html_support.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "test(server): markdown table and rendered-html parsers for the drift test"
```

---

## Task 8: `/privacy` and the §4 drift test

The highest-value task in the plan. Read spec §4.3 and §6 first.

**Files:**
- Create: `server/apps/web/components/pages/privacy_page.tsx`
- Create: `server/apps/web/app/[locale]/privacy/page.tsx`
- Modify: `server/apps/web/messages/en.json` (the `privacy` section)
- Test: `server/apps/web/__tests__/privacy_drift.test.tsx`

**Interfaces:**
- Consumes: `DataTable` (id `"lifecycle"`), `Prose`, `Callout`, `ContactBlock`, `ServiceStatusNotice` (Task 6); `extractSection`/`parseFirstTable`/`extractStatusLine` (Task 7); `extractTable` (Task 7); `COMPLETE_CONFIG` (Task 5).
- Produces: `function PrivacyPage(props: { messages: Messages; config: AppConfig; docStatus: string }): JSX.Element`

**The `docStatus` prop.** The page states which draft of `docs/07-privacy-and-compliance.md` it derives from. The route file reads that file at request time and passes `extractStatusLine(...)`. Reading a repo doc from a route handler is acceptable *only* for this one string; the retention rows are **not** read from the doc (spec §6.2 — a Filipino translation could not exist if they were).

> **Wait.** Reading the doc at runtime means the file must be inside the Docker image, and the build context is `server/` — `docs/` is not in it. Do **not** read the file at runtime. Instead: the catalog carries `privacy.sourceStatus` as a literal, and the drift test asserts it equals `extractStatusLine(doc)`. Same guarantee, no runtime file access, no image-layout coupling. Implement it that way; the prop is dropped.

Corrected interface: `function PrivacyPage(props: { messages: Messages; config: AppConfig }): JSX.Element`

- [ ] **Step 1: Write the failing drift test**

`server/apps/web/__tests__/privacy_drift.test.tsx`:

```tsx
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyPage } from "@/components/pages/privacy_page.js";
import { getMessages } from "@/messages/index.js";
import { extractTable } from "@/test_support/html.js";
import { extractSection, extractStatusLine, parseFirstTable } from "@/test_support/markdown_table.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

// The one thing that breaks if server/ is ever extracted into its own repository.
const DOC_PATH = fileURLToPath(
  new URL("../../../../docs/07-privacy-and-compliance.md", import.meta.url),
);
const LIFECYCLE_HEADING = "## 4. Data lifecycle";

function doc(): string {
  if (!existsSync(DOC_PATH)) {
    throw new Error(
      `The privacy source document is missing at ${DOC_PATH}. This test binds the ` +
        "published retention table to docs/07-privacy-and-compliance.md §4; if server/ " +
        "moved, fix the path rather than deleting the test.",
    );
  }
  return readFileSync(DOC_PATH, "utf8");
}

function renderedPrivacy(): string {
  return renderToStaticMarkup(
    <PrivacyPage messages={getMessages("en")} config={COMPLETE_CONFIG} />,
  );
}

describe("privacy notice / lifecycle table drift", () => {
  it("finds a lifecycle table with at least the eight rows §4 documents", () => {
    const table = parseFirstTable(extractSection(doc(), LIFECYCLE_HEADING));
    expect(table.rows.length).toBeGreaterThanOrEqual(8);
    expect(table.headers.length).toBeGreaterThanOrEqual(6);
  });

  // privacy §2.4: "retention periods (matching the lifecycle table in §4 exactly)".
  // Editing §4 without editing messages/en.json must fail here.
  it("renders every row and every column of §4 verbatim", () => {
    const fromDoc = parseFirstTable(extractSection(doc(), LIFECYCLE_HEADING));
    const fromPage = extractTable(renderedPrivacy(), "lifecycle");
    expect(fromPage.headers).toEqual(fromDoc.headers);
    expect(fromPage.rows).toEqual(fromDoc.rows);
  });

  it("names the draft it derives from, so the page cannot claim a freshness the doc lacks", () => {
    expect(getMessages("en").privacy.sourceStatus).toBe(extractStatusLine(doc()));
    expect(renderedPrivacy()).toContain(extractStatusLine(doc()));
  });

  it("renders a non-empty heading and no unfilled marker when configuration is complete", () => {
    const html = renderedPrivacy();
    expect(html).not.toContain("[ REQUIRED:");
    expect(html).toContain("<h1");
  });

  it("covers every item RA 10173 §2.4 requires the notice to contain", () => {
    const html = renderedPrivacy();
    for (const anchor of [
      "who-is-responsible",
      "why-we-process",
      "what-data-exists",
      "how-processing-happens",
      "who-receives-it",
      "automated-decisions",
      "your-rights",
      "complaints",
      "not-requested",
      "other-peoples-names",
      "if-something-goes-wrong",
    ]) {
      expect(html).toContain(`id="${anchor}"`);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/__tests__/privacy_drift.test.tsx`
Expected: FAIL — cannot resolve `@/components/pages/privacy_page.js`.

- [ ] **Step 3: Fill the `privacy` catalog section**

Structure (fill every value; the retention rows must be the normalized output of Task 7's parser applied to §4, which is easiest obtained by running the parser once in a scratch node script and pasting the result):

```jsonc
"privacy": {
  "title": "Privacy notice",
  "intro": "…",                      // privacy §1, three sentences
  "sourceStatus": "Draft v1 · 2026-08-02",
  "sourceNote": "Derived from an internal draft dated {status}; not yet reviewed by counsel.",
  "sections": {
    "whoIsResponsible":   { "heading": "Who is responsible", "paragraphs": [...] },   // §2.1, §2.4
    "whyWeProcess":       { "heading": "Why we process your data", "headers": [...], "rows": [...] }, // §2.3 table
    "whatDataExists":     { "heading": "What data exists, where it lives, how long it stays",
                            "caption": "…", "headers": [...], "rows": [...],          // §4 — DRIFT TESTED
                            "invariants": [ "…", "…", "…" ] },                        // §4's three invariants
    "howProcessingHappens": { "heading": "How processing happens", "paragraphs": [...], "bullets": [...] }, // §5
    "whoReceivesIt":      { "heading": "Who receives your data", "paragraphs": [...] },  // §2.4 recipients
    "automatedDecisions": { "heading": "Automated decisions, and how to correct them", "paragraphs": [...] },
    "yourRights":         { "heading": "Your rights", "headers": ["Right","How PeraPlano honours it"], "rows": [...] }, // §2.8
    "complaints":         { "heading": "Complaints", "paragraphs": [...] },
    "notRequested":       { "heading": "What we deliberately do not ask for",
                            "headers": ["Not requested","Why"], "rows": [...] },      // §3.2
    "otherPeoplesNames":  { "heading": "Other people's names in your notifications", "paragraphs": [...], "bullets": [...] }, // §6
    "ifSomethingGoesWrong": { "heading": "If something goes wrong", "paragraphs": [...] } // §2.7
  }
}
```

Copy rules for this section:
- The `whatDataExists.rows` are the **normalized** §4 rows — no bold markers, no backticks, escaped pipes unescaped. They must equal `parseFirstTable(extractSection(doc, "## 4. Data lifecycle")).rows` exactly.
- `whyWeProcess`, `yourRights` and `notRequested` reproduce §2.3, §2.8 and §3.2's tables. These are **not** drift-tested (their cells carry repo-relative doc links that make no sense publicly), so they are rewritten for a public reader — but every row must be present and no row may claim more than the source.
- Nothing in this section names a company, a person, an address or a registration number. Those come from `config.contacts`.

- [ ] **Step 4: Write `components/pages/privacy_page.tsx`**

A synchronous function component taking `{ messages, config }`. Order: `<h1>` → source-status line (`sourceNote` with `{status}` substituted) → `<ServiceStatusNotice/>` → the eleven sections, each `<section id="…">` using the anchor ids the test asserts. `whatDataExists` renders `<DataTable id="lifecycle" …/>` followed by the three invariants as a list. `whoIsResponsible` renders two `<ContactBlock>`s fed from `config.contacts`.

- [ ] **Step 5: Write the route file**

`server/apps/web/app/[locale]/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getConfig } from "@peraplano/common";
import { PrivacyPage } from "@/components/pages/privacy_page.js";
import { getMessages } from "@/messages/index.js";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: "en" }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(locale);
  return {
    title: `${messages.privacy.title} — ${messages.meta.siteName}`,
    alternates: { canonical: `${getConfig().publicBaseUrl}/${locale}/privacy` },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: "en" }> }) {
  const { locale } = await params;
  return <PrivacyPage messages={getMessages(locale)} config={getConfig()} />;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run apps/web/__tests__/privacy_drift.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Prove the test actually detects drift**

Temporarily change one character in a `whatDataExists.rows` cell in `messages/en.json`, re-run, confirm FAIL with a row diff, then revert. A drift test that has never been seen to fail is a claim, not a test.

- [ ] **Step 8: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): privacy notice with a drift test against the lifecycle table"
```

---

## Task 9: `/data-deletion`

**Files:**
- Create: `server/apps/web/components/pages/data_deletion_page.tsx`, `server/apps/web/app/[locale]/data-deletion/page.tsx`
- Modify: `server/apps/web/messages/en.json` (`dataDeletion`)
- Test: `server/apps/web/__tests__/data_deletion.test.tsx`

**Interfaces:**
- Consumes: `ServiceStatusNotice`, `Prose`, `Callout`; `SERVICE_CAPABILITIES`.
- Produces: `function DataDeletionPage(props: { messages: Messages; config: AppConfig }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SERVICE_CAPABILITIES } from "@peraplano/common";
import { DataDeletionPage } from "@/components/pages/data_deletion_page.js";
import { PrivacyPage } from "@/components/pages/privacy_page.js";
import { getMessages } from "@/messages/index.js";
import { stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const messages = getMessages("en");
const deletion = () =>
  renderToStaticMarkup(<DataDeletionPage messages={messages} config={COMPLETE_CONFIG} />);

describe("/data-deletion", () => {
  it("states there is nothing on a server to delete", () => {
    expect(stripTags(deletion())).toContain("no copy on our servers");
  });

  it("never implies an account exists", () => {
    const text = stripTags(deletion()).toLowerCase();
    expect(text).not.toContain("your account");
    expect(text).not.toContain("sign in to delete");
    expect(text).not.toContain("log in");
  });

  it("gives all three destructive routes", () => {
    const text = stripTags(deletion());
    expect(text).toContain("Wipe everything");
    expect(text).toContain("Settings");
    expect(text).toContain("Clear data");
    expect(text).toContain("Uninstall");
  });

  it("says raw notification text purges itself after 30 days", () => {
    expect(stripTags(deletion())).toContain("30 days");
  });

  it("describes a future deletion route only in the conditional", () => {
    const text = stripTags(deletion());
    expect(text).toContain("does not offer accounts today");
    expect(SERVICE_CAPABILITIES.accounts).toBe(false);
  });

  // Two pages disagreeing about whether a server holds your money data is the failure
  // a regulator finds by reading both in one sitting. One catalog entry, one component.
  it("renders the same service-status text as /privacy, byte for byte", () => {
    const extract = (html: string): string => {
      const match = /<aside\b[^>]*data-service-status[^>]*>([\s\S]*?)<\/aside>/i.exec(html);
      if (match?.[1] === undefined) throw new Error("no service-status block found");
      return stripTags(match[1]);
    };
    expect(extract(deletion())).toBe(
      extract(renderToStaticMarkup(<PrivacyPage messages={messages} config={COMPLETE_CONFIG} />)),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/__tests__/data_deletion.test.tsx`
Expected: FAIL — unresolved import, and (once the component exists) the consistency test until `ServiceStatusNotice` carries `data-service-status`.

- [ ] **Step 3: Add `data-service-status` to `ServiceStatusNotice`'s root `<aside>`**

The consistency test finds the block by that attribute. Add it in `components/content/service_status_notice.tsx` with a comment saying which test depends on it.

- [ ] **Step 4: Fill the `dataDeletion` catalog section and write the component**

Seven sections, in this order (spec §4.6):

1. `status` — rendered by `ServiceStatusNotice`.
2. `deleteOne` — privacy §7: delete any Transaction from its detail screen; every parsed field is editable.
3. `stopWithoutDeleting` — privacy §7: pause listening (global), pause per provider, telemetry opt-out.
4. `deleteEverything` — three routes in order:
   - "In the app: More → Settings → Privacy → **Wipe everything.** The confirmation screen states exactly what will be destroyed." *(privacy §7)*
   - "On the phone: Settings → Apps → PeraPlano → Storage → **Clear data.** This destroys the encrypted database and every setting; the app returns to its first-run state."
   - "**Uninstall.** Removes the app and its data together."
   Recommend the first, because it is the only route that knows what it is deleting.
5. `selfDeleting` — privacy §4 row 1: raw notification text carries a 30-day time-to-live and purges itself with or without any action from you.
6. `outOfOurReach` — privacy §4 row 7 (CSV exports you saved are outside the app's protection; delete them yourself) and §4 row 8 (support correspondence retained ≤ 24 months after case closure; ask and we will delete it sooner).
7. `ifAccountsEverExist` — **conditional, present-tense-negative.** Opens "PeraPlano does not offer accounts today." Then: if a sign-in identity is ever introduced for cloud backup, a web deletion route will appear on this page and will remove the identity and all server-side backup data within 30 days, per Google Play's account-deletion policy. Never uses the words "your account."

- [ ] **Step 5: Write the route file** — same shape as Task 8 Step 5, with `title` = `messages.dataDeletion.title` and canonical `/${locale}/data-deletion`.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run apps/web/__tests__/data_deletion.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): data deletion page with no account implied"
```

---

## Task 10: `/installed-apps`

**Files:**
- Create: `server/apps/web/components/pages/installed_apps_page.tsx`, `server/apps/web/app/[locale]/installed-apps/page.tsx`
- Modify: `server/apps/web/messages/en.json` (`installedApps`)
- Test: `server/apps/web/__tests__/installed_apps.test.tsx`

**Sources:** roadmap §0.2 verbatim on the risk; privacy §3.2 on what is not requested.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstalledAppsPage } from "@/components/pages/installed_apps_page.js";
import { getMessages } from "@/messages/index.js";
import { stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const text = () =>
  stripTags(
    renderToStaticMarkup(
      <InstalledAppsPage messages={getMessages("en")} config={COMPLETE_CONFIG} />,
    ),
  );

describe("/installed-apps", () => {
  it("says exactly what is read", () => {
    expect(text()).toContain("package names");
  });

  it("names the permission", () => {
    expect(text()).toContain("QUERY_ALL_PACKAGES");
  });

  // roadmap §0.2: Google's enumerated permitted uses "do not obviously cover" this, and
  // "a rejection is a live possibility". A confident page contradicts our own decision record.
  it("concedes the permitted-use ambiguity rather than claiming coverage", () => {
    const body = text();
    expect(body).toContain("do not obviously cover");
    expect(body.toLowerCase()).not.toContain("google permits this");
    expect(body.toLowerCase()).not.toContain("approved by google");
  });

  it("describes the queries-allowlist fallback and its user-visible cost", () => {
    const body = text();
    expect(body).toContain("<queries>");
    expect(body).toContain("allowlist");
    expect(body).toContain("app update");
  });

  it("lists what is never read", () => {
    const body = text();
    expect(body).toContain("usage");
    expect(body).toContain("never");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/__tests__/installed_apps.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Fill the `installedApps` catalog section**

Six sections (spec §4.5), each with its source in a code comment on the component:

1. `whatIsRead` — "PeraPlano reads the **package names** of the applications installed on your phone — identifier strings such as `com.globe.gcash.android`. That is the whole of it."
2. `whatIsNeverRead` — nothing inside any other app: no contents, no screens, no usage statistics, no record of how often you open anything. No accessibility service, no SMS permission, no usage-access permission. *(privacy §3.2)*
3. `why` — the provider picker at onboarding must show the bank and e-wallet apps you actually have. Before the scan it was populated from thirteen guessed, unverified package names against a listener history that is empty on a fresh install, which asks you to recognise something you have no way to recognise. *(roadmap §0.2, §0.3)*
4. `thePermission` — `QUERY_ALL_PACKAGES` is a Google Play **restricted** permission requiring a declaration form on every release. State plainly: "Google's enumerated permitted uses **do not obviously cover** detecting which bank apps you have installed — the financial carve-out is worded for fraud and security checks. We make the declaration on the basis that the scan exists only to configure which notifications you want read. Google may disagree, and a rejection is a live possibility." *(roadmap §0.2 verbatim)*
5. `theAlternative` — discovery sits behind one interface with two implementations: the scan, and a `<queries>` manifest **allowlist** of known PH bank and e-wallet packages. If a review ever bounces, the swap is one implementation, not a redesign of onboarding. What changes for you: only apps on the list can be detected, and a newly launched e-wallet needs an app update before it appears.
6. `whereItGoes` — the result configures the picker. What persists afterwards is your provider selection, not a copy of your app inventory. Nothing about it is transmitted. *(This page states the handling on this spec's authority; `docs/07-privacy-and-compliance.md` §4 has no lifecycle row for it yet — recorded in the spec's §13 as an owner action.)*

- [ ] **Step 4: Write the component and route file** — same shapes as Task 8.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run apps/web/__tests__/installed_apps.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): installed-apps disclosure page"
```

---

## Task 11: `/support`

**Files:**
- Create: `server/apps/web/components/pages/support_page.tsx`, `server/apps/web/app/[locale]/support/page.tsx`
- Modify: `server/apps/web/messages/en.json` (`support`)
- Test: `server/apps/web/__tests__/support.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupportPage } from "@/components/pages/support_page.js";
import { getMessages } from "@/messages/index.js";
import { extractTable, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG, HOLLOW_CONFIG } from "@/test_support/env_fixtures.js";

const render = (config = COMPLETE_CONFIG) =>
  renderToStaticMarkup(<SupportPage messages={getMessages("en")} config={config} />);

describe("/support", () => {
  it("publishes the support mailbox as a mailto link", () => {
    expect(render()).toContain(`mailto:${COMPLETE_CONFIG.contacts.SUPPORT_EMAIL}`);
  });

  it("reproduces all thirteen user controls from privacy §7", () => {
    expect(extractTable(render(), "controls").rows).toHaveLength(13);
  });

  it("reproduces all seven data-subject rights from privacy §2.8", () => {
    expect(extractTable(render(), "rights").rows).toHaveLength(7);
  });

  it("warns against pasting raw notification text and states how long support mail is kept", () => {
    const text = stripTags(render());
    expect(text).toContain("raw notification text");
    expect(text).toContain("24 months");
  });

  it("names the NPC as the complaint route", () => {
    expect(stripTags(render())).toContain("National Privacy Commission");
  });

  it("shows the unfilled marker rather than a blank when the DPO is not configured", () => {
    expect(render(HOLLOW_CONFIG)).toContain("[ REQUIRED: DPO_NAME ]");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/web/__tests__/support.test.tsx`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Fill the `support` catalog section**

Six sections (spec §4.2): `howToReachUs`, `beforeYouWrite`, `controls` (a table, `id="controls"`, headers `Control` / `What it does` / `Where`, **all thirteen rows from privacy §7** — Pause listening (global), Pause per provider, Listener health, Transparency screen, Parser diagnostics, Review Queue, Edit anything, Export everything, Wipe everything, Cloud backup toggle, Telemetry opt-out, App-alert controls, Sign-in identity deletion, Consent review — note that is fourteen entries in the source; count the rows in §7's table when you write them and make the test's expected number match reality rather than this sentence), `rights` (a table, `id="rights"`, headers `Your right` / `How PeraPlano honours it`, all seven rows from privacy §2.8), `dpo`, `complaints`.

> **Count check before writing the test number:** open privacy §7 and count the table's data rows. Set the `controls` expectation in Step 1 to that number. Do not adjust the source to fit the test.

- [ ] **Step 4: Write the component and route file.**

- [ ] **Step 5: Run to verify it passes.** Run: `npx vitest run apps/web/__tests__/support.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): support page with the full control and rights tables"
```

---

## Task 12: `/terms`

**Files:**
- Create: `server/apps/web/components/pages/terms_page.tsx`, `server/apps/web/app/[locale]/terms/page.tsx`
- Modify: `server/apps/web/messages/en.json` (`terms`)
- Test: `server/apps/web/__tests__/terms.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermsPage } from "@/components/pages/terms_page.js";
import { getMessages } from "@/messages/index.js";
import { extractTable, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const html = () =>
  renderToStaticMarkup(<TermsPage messages={getMessages("en")} config={COMPLETE_CONFIG} />);

describe("/terms", () => {
  it("reproduces the eleven-row tier matrix from the brief §8", () => {
    expect(extractTable(html(), "tiers").rows).toHaveLength(11);
  });

  it("states the permanent non-goals as disclaimers", () => {
    const text = stripTags(html());
    expect(text).toContain("never holds, moves, or touches");
    expect(text).toContain("not a financial advisor");
  });

  it("says prices are not published yet rather than inventing one", () => {
    const text = stripTags(html());
    expect(text).toContain("not published");
    expect(text).not.toMatch(/₱\s?\d/);
  });

  // The block is deliberately visible. Removing it must be a conscious act in a diff,
  // which is what this assertion makes it.
  it("carries the counsel-required block naming all seven undrafted clauses", () => {
    const text = stripTags(html());
    expect(text).toContain("Clauses a lawyer still has to write");
    expect(text).toContain("Governing law");
    expect(text).toContain("Limitation of liability");
    expect(text).toContain("cannot be offered for sale");
    expect(getMessages("en").counselRequired.clauses).toHaveLength(7);
  });

  it("says purchases run through Google Play and that no payment details are stored", () => {
    const text = stripTags(html());
    expect(text).toContain("Google Play");
    expect(text).toContain("no payment");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: unresolved import.

- [ ] **Step 3: Fill the `terms` catalog section**

Six sections (spec §4.4): `whatPeraPlanoIs` (brief §9 non-goals 1 and 2 as disclaimers), `theLedgerIsDerived` (brief §5 step 4 + §10; parses can be wrong, check against your bank's own records), `tiers` (table `id="tiers"`, headers `Capability` / `Free` / `Plus`, the eleven rows of brief §8's matrix verbatim, plus the gate-behavior principle and privacy §8's "privacy controls are never Plus-gated" as prose beneath), `pricingNotPublished` (brief §8), `purchases` (privacy §4 row 4), and `<CounselRequiredNotice/>`.

- [ ] **Step 4: Write the component and route file.**

- [ ] **Step 5: Run to verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): terms page with a visible counsel-required block"
```

---

## Task 13: `/` marketing

**Files:**
- Create: `server/apps/web/components/pages/marketing_page.tsx`
- Modify: `server/apps/web/app/[locale]/page.tsx`, `server/apps/web/messages/en.json` (`marketing`)
- Test: `server/apps/web/__tests__/marketing.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingPage } from "@/components/pages/marketing_page.js";
import { getMessages } from "@/messages/index.js";
import { firstHeadingText, stripTags } from "@/test_support/html.js";
import { COMPLETE_CONFIG } from "@/test_support/env_fixtures.js";

const html = () =>
  renderToStaticMarkup(<MarketingPage messages={getMessages("en")} config={COMPLETE_CONFIG} />);

describe("/", () => {
  it("leads with the tagline from the brief §2", () => {
    expect(stripTags(html())).toContain("You never log a transaction; you only set the rules.");
  });

  it("has a non-empty heading", () => {
    expect(firstHeadingText(html()).length).toBeGreaterThan(0);
  });

  it("presents all three personas from the brief §4", () => {
    const text = stripTags(html());
    expect(text).toContain("kinsenas");
    expect(text).toContain("gig");
    expect(text).toContain("e-wallet");
  });

  it("defines the Filipino terms it uses, per the brief §7 voice rule", () => {
    const text = stripTags(html());
    expect(text).toContain("utang");
    expect(text).toContain("padala");
    expect(text).toMatch(/kinsenas\b[^.]*15th and 30th/);
  });

  // brief §5 flags its own sample notification as invented. A fabricated bank message
  // presented as real reads badly at review.
  it("marks the sample notification as illustrative", () => {
    expect(stripTags(html()).toLowerCase()).toContain("illustrative");
  });

  it("quotes no price, because the brief §8 leaves pricing undecided", () => {
    expect(stripTags(html())).not.toMatch(/₱\s?\d/);
  });

  it("renders no Play badge while there is no listing to link to", () => {
    expect(html()).not.toContain('href="#"');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Fill the `marketing` catalog section**

Seven sections (spec §4.1): `hero` (name, tagline verbatim, one sentence from brief §1, `"storeBadge": null`), `whatItDoes` (brief §5's five steps plus the illustrative example carrying its own disclaimer), `whoItIsFor` (brief §4's three personas as cards), `whyThePhilippines` (brief §3's six facts), `whatItIsNot` (brief §9's permanent non-goals, short, linking to `/terms`), `privacyPromise` (three sentences from privacy §1, linking to `/privacy`), `tiersLink` (one line pointing at `/terms` for the Free/Plus comparison).

- [ ] **Step 4: Write the component; wire it into `app/[locale]/page.tsx`.**

- [ ] **Step 5: Run to verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): marketing page"
```

---

## Task 14: Metadata routes, middleware, and the structural guard tests

**Files:**
- Create: `server/apps/web/app/robots.ts`, `app/sitemap.ts`, `app/api/health/route.ts`, `middleware.ts`
- Test: `server/apps/web/__tests__/structure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
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
  "support/page.tsx",
  "privacy/page.tsx",
  "terms/page.tsx",
  "installed-apps/page.tsx",
  "data-deletion/page.tsx",
] as const;

describe("route inventory", () => {
  it("has exactly the six locale routes", () => {
    const base = `${WEB_ROOT}app/[locale]`;
    const found = walk(base)
      .filter((file) => file.endsWith("page.tsx"))
      .map((file) => file.slice(base.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(found).toEqual([...EXPECTED_ROUTES].sort());
  });

  it("links every route from both the header and the footer", () => {
    const header = readFileSync(`${WEB_ROOT}components/chrome/site_header.tsx`, "utf8");
    const footer = readFileSync(`${WEB_ROOT}components/chrome/site_footer.tsx`, "utf8");
    for (const key of ["support", "privacy", "terms", "installed-apps", "data-deletion"]) {
      expect(header).toContain(key);
      expect(footer).toContain(key);
    }
  });
});

describe("hostname discipline", () => {
  // PUBLIC_BASE_URL drives canonical tags, og:url, sitemap.xml and robots.txt. A literal
  // in app/ or components/ silently wins over the environment on a staging deploy.
  it("contains no hostname literal under app/ or components/", () => {
    const offenders = [...walk(`${WEB_ROOT}app`), ...walk(`${WEB_ROOT}components`)]
      .filter((file) => /\.(ts|tsx|css|json)$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("filhmar.online"));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: the route-inventory assertion fails until every page exists, and passes once Tasks 8–13 have landed.

- [ ] **Step 3: Write the metadata routes**

`app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { getConfig } from "@peraplano/common";

// Dynamic for the same reason as the locale layout: PUBLIC_BASE_URL is a runtime value,
// and a prerendered robots.txt would bake whatever the build host happened to have.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    // Every page here exists to be found — by a person, by a Play reviewer, by a crawler.
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${getConfig().publicBaseUrl}/sitemap.xml`,
  };
}
```

`app/sitemap.ts` — same `force-dynamic`, emitting the six locale routes for every entry of `SUPPORTED_LOCALES` with `changeFrequency: "monthly"`.

`app/api/health/route.ts`:

```ts
import { buildHealthReport, getConfig, parseEnvironment } from "@peraplano/common";

export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();

export function GET(): Response {
  const report = buildHealthReport({
    service: "peraplano-web",
    version: process.env["npm_package_version"] ?? "0.0.0",
    startedAt: STARTED_AT,
    now: Date.now(),
    configComplete: parseEnvironment(process.env).missing.length === 0,
  });
  void getConfig();
  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
}
```

> Decide during implementation whether `degraded` should answer 503. It should **not**: the Docker `HEALTHCHECK` uses this endpoint, and a dev container with no compliance values would restart-loop. Return 200 with `status: "degraded"` in the body, and say why in a comment.

`middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, readOrCreateRequestId } from "@peraplano/common";

/**
 * One id per request, echoed back so a report of "this page was wrong at 14:02" can be
 * matched to a log line. Nothing else: this site has no sessions, no cookies, no auth.
 */
export function middleware(request: NextRequest): NextResponse {
  const requestId = readOrCreateRequestId(request.headers);
  const response = NextResponse.next();
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 4: Write `instrumentation.ts` — the production boot gate**

```ts
import { assertProductionConfig, createLogger, parseEnvironment } from "@peraplano/common";

/**
 * Next runs this once when the server starts and NOT during `next build` — verified on
 * this repo, and it is the whole reason the production gate can live here. Throwing
 * aborts boot with a named error, so a container can never serve a privacy notice with
 * a blank DPO. See the spec's §5.3.
 */
export function register(): void {
  const result = parseEnvironment(process.env);
  const log = createLogger({ service: "peraplano-web", level: result.config.logLevel });

  if (result.config.nodeEnv === "production") {
    if (result.missing.length > 0) {
      log.error("compliance configuration incomplete", { missing: result.missing.join(",") });
    }
    assertProductionConfig(result);
  } else if (result.missing.length > 0) {
    // Dev renders "[ REQUIRED: … ]" on the page instead of refusing to start, so design,
    // copy review and the Play evidence recording are not blocked on a lawyer.
    log.warn("rendering REQUIRED markers for unconfigured compliance values", {
      missing: result.missing.join(","),
    });
  }

  log.info("server started", {
    nodeEnv: result.config.nodeEnv,
    baseUrl: result.config.publicBaseUrl,
    configComplete: result.missing.length === 0,
  });
}
```

- [ ] **Step 5: Run to verify the guards pass**

Run: `npx vitest run apps/web/__tests__/structure.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the boot gate both ways, by hand**

```bash
npm run build -w @peraplano/web
```
Then boot the standalone server twice from `apps/web/.next/standalone`:
1. with `NODE_ENV=production` and **no** compliance vars → expect the process to exit non-zero printing `MissingComplianceConfigError` and all six field names.
2. with `NODE_ENV=production` and the complete set → expect `Ready`, and `/en/privacy` to contain no `[ REQUIRED:`.

Record both outputs in the commit body. This is the one behaviour no unit test can prove end to end.

- [ ] **Step 7: Commit**

```bash
git add server/apps/web
git commit -m "feat(server): metadata routes, correlation middleware and the production boot gate"
```

---

## Task 15: Container and compose

**Files:**
- Create: `server/Dockerfile`, `server/.dockerignore`, `server/.env.example`
- Create: `docker-compose.yml` (repo root)

- [ ] **Step 1: Write `server/.env.example`**

Never a plausible value for the six. Comment every one with its source section.

```bash
# PeraPlano public site — runtime configuration.
#
# Copy to server/.env.local and fill in. docker-compose.yml injects this file at RUNTIME;
# nothing here is ever baked into the image. In production a missing value below aborts
# boot with MissingComplianceConfigError; in development it renders "[ REQUIRED: FIELD ]"
# on the page. Both behaviours exist so a blank DPO cannot be published by accident.

NODE_ENV=production
LOG_LEVEL=info

# Drives canonical tags, og:url, sitemap.xml and robots.txt. No hostname is hardcoded
# anywhere under apps/web/app.
PUBLIC_BASE_URL=https://peraplano.filhmar.online

# --- Legal identifiers. NOT KNOWN as of 2026-08-20. Do not guess any of these. ---

# Legal name of the entity acting as Personal Information Controller (privacy §2.1, §2.4).
PIC_LEGAL_NAME=
# Its registered address (privacy §2.4).
PIC_ADDRESS=
# The appointed Data Protection Officer (privacy §2.5 — appointed before public launch
# regardless of registration thresholds).
DPO_NAME=
# DPO contact address. Also appears in the Play listing support details (privacy §2.4).
DPO_EMAIL=
# Support mailbox. Play requires a support contact on the listing (privacy §2.3).
SUPPORT_EMAIL=
# NPC registration status or number (privacy §2.5). The planning position is "register";
# the actual status is unknown. Supply a real status, even if it is "registration pending".
NPC_REGISTRATION=
```

- [ ] **Step 2: Write `server/.dockerignore`**

```
node_modules
**/node_modules
**/.next
.git
.gitignore
*.md
Dockerfile
.dockerignore
docker-compose*.yml
coverage
# Never bake secrets into a layer — they survive in image history even if a later layer
# deletes them. Runtime values arrive via compose env_file.
.env
.env.*
!.env.example
```

- [ ] **Step 3: Write `server/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# Per-service targets even though there is one service today (blueprint §7.1): adding
# apps/api later is a copy of the last stage, not a restructure of this file.

# ---- base: the only place an OS patch has to land ----
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install the whole workspace against the lockfile ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY libs/common/package.json ./libs/common/package.json
RUN npm ci

# ---- build: compile once; libs/common is transpiled into the app ----
FROM deps AS build
COPY . .
# next/font downloads Manrope here and serves it from our own origin, so a visitor to the
# privacy notice makes zero third-party requests while reading a page that says there are
# no third-party recipients. This step needs network; that failure is loud and acceptable.
RUN npm run build -w @peraplano/web

# ---- runtime-base: hardening shared by every service target ----
FROM base AS runtime-base
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# ---- web ----
FROM runtime-base AS web
# npm workspaces put the standalone entrypoint at apps/web/server.js with hoisted
# node_modules at the root — not the flat server.js a single-package Next app emits.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
# /api/health answers 200 with status "degraded" when compliance values are missing, so a
# half-configured dev container reports honestly instead of restart-looping.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 4: Write the root `docker-compose.yml`**

```yaml
# PeraPlano — server-side only. mobile/ is not containerised and no service here
# references it.
#
# Port allocation on this box, so the next person allocating one does not collide:
#   3000 / 5000  jms-e-talyer production
#   3001         fill-main (filhmar.online)
#   3002 / 5002  genesys production
#   3003         THIS SERVICE — peraplano.filhmar.online
#   5003         kognita production
#   5004         kognita staging
#   5005         RESERVED for a future PeraPlano backend. Do not take it.
services:
  peraplano-web:
    build:
      context: ./server
      dockerfile: Dockerfile
      target: web
    # Runtime configuration — the legal identifiers in the published privacy notice —
    # is injected here and never baked into the image. See server/.env.example.
    env_file:
      - ./server/.env.local
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: 0.0.0.0
    # Loopback only. The box already runs a host nginx serving the other apps; it
    # reverse-proxies peraplano.filhmar.online to 127.0.0.1:3003. Binding to 127.0.0.1
    # keeps the container off the public interface, so nginx is the only entry.
    ports:
      - "127.0.0.1:3003:3000"
    restart: unless-stopped
```

- [ ] **Step 5: Verify the image builds and serves**

```bash
docker build -t peraplano-web:test --target web ./server
docker run --rm -p 127.0.0.1:3399:3000 -e NODE_ENV=production -e PIC_LEGAL_NAME=... peraplano-web:test
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3399/en/privacy
```

Expected: `200`. Also run it once with no compliance env and confirm the container exits with `MissingComplianceConfigError`.

If Docker is not available on this machine, say so plainly in the commit body and in the final report rather than claiming the image was verified.

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/.dockerignore server/.env.example docker-compose.yml
git commit -m "build(server): multi-stage image and root compose on port 3003"
```

---

## Task 16: nginx site config

**Files:**
- Create: `docs/nginx/peraplano-production.conf`

Model: `D:\My Folder\fill-main\docs\nginx\filhmar-production.conf`. Reproduce its structure, not its values.

- [ ] **Step 1: Write the file**

```nginx
# Reference nginx site for peraplano.filhmar.online.
#
# The box already runs a host nginx serving other apps (jms-e-talyer, fill-main on
# filhmar.online, genesys, kognita). This site is ADDED to it — do not remove or replace
# the other enabled sites. PeraPlano's Next.js container is published on 127.0.0.1:3003
# (see the repo-root docker-compose.yml), so nothing reaches it except through this
# reverse proxy on the same host.
#
# server_name is the SUBDOMAIN ONLY. filhmar.online itself is served by the fill-main
# site config; listing the apex here would create two server blocks competing for it,
# which nginx resolves by whichever loaded first — a coin flip nobody should rely on.
#
# This file is deliberately HTTP-only. `certbot --nginx` rewrites it in place: it adds
# `listen 443 ssl`, the ssl_certificate lines, and turns the port-80 block into an HTTPS
# redirect — reusing the location blocks below, so routing is preserved.
#
# Shipping a 443 block up front does not work: nginx refuses to load a `listen ... ssl`
# server that has no certificate, and certbot --nginx cannot modify a config that will
# not load. They deadlock before the first cert issues.
#
# Usage (on the box):
#   sudo cp docs/nginx/peraplano-production.conf /etc/nginx/sites-available/peraplano
#   sudo ln -sf /etc/nginx/sites-available/peraplano /etc/nginx/sites-enabled/peraplano
#   sudo nginx -t && sudo systemctl reload nginx
#   sudo certbot --nginx -d peraplano.filhmar.online
#
# DNS for peraplano.filhmar.online must resolve to this box before certbot runs.
# Renewal is automatic via certbot's systemd timer — the acme-challenge location below
# keeps working after the redirect is added, so renewals succeed unattended.

upstream peraplano_web {
    server 127.0.0.1:3003;
}

server {
    listen 80;
    listen [::]:80;
    server_name peraplano.filhmar.online;

    # This site accepts no uploads and posts no forms — there is deliberately no contact
    # form (a form would make the web tier a processing activity with its own lawful
    # basis and retention period). 1m is already far more than any request needs.
    client_max_body_size 1m;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    # X-Forwarded-Proto tells the app the original request was HTTPS once certbot has
    # added the redirect, so canonical URLs and og:url stay on https.
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";

    # Let the ACME http-01 challenge through untouched — first issuance and every renewal
    # after certbot adds the HTTPS redirect.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Long-cache immutable Next.js build assets. The pages themselves are dynamic (they
    # carry runtime-injected compliance contacts), so this block is what keeps the site
    # cheap to serve.
    location /_next/static/ {
        proxy_pass http://peraplano_web;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Everything else is the Next.js app. No URI part on proxy_pass, so the request path
    # passes through unmodified.
    location / {
        proxy_pass http://peraplano_web;
    }
}
```

- [ ] **Step 2: Verify it against the precedent**

Diff the structure against `D:\My Folder\fill-main\docs\nginx\filhmar-production.conf`: same block order, same header set, same acme passthrough, same `_next/static` treatment. Differences must be only: hostname, upstream name, port, `client_max_body_size`, and the added DNS note.

- [ ] **Step 3: Commit**

```bash
git add docs/nginx/peraplano-production.conf
git commit -m "docs(nginx): http-only site config for peraplano.filhmar.online"
```

---

## Task 17: Lint, smoke suite, CI

**Files:**
- Create: `server/eslint.config.mjs`, `server/vitest.smoke.config.ts`, `server/smoke/global_setup.ts`, `server/smoke/routes.smoke.test.ts`
- Create: `.github/workflows/server-ci.yml`

- [ ] **Step 1: Write the smoke test**

`server/smoke/routes.smoke.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the global setup**

`server/smoke/global_setup.ts` — export a default async function that:
1. runs `npm run build -w @peraplano/web` (skip if `SMOKE_SKIP_BUILD=1`),
2. picks a free port,
3. spawns `node apps/web/server.js` from `apps/web/.next/standalone` with a **complete** environment — `NODE_ENV=production`, the six compliance values set to obvious `.test` fakes, `PUBLIC_BASE_URL=https://smoke.example.test`,
4. polls `/api/health` until 200 or a 60-second deadline, then sets `process.env.SMOKE_BASE_URL`,
5. returns a teardown that kills the child.

`server/vitest.smoke.config.ts` points `include` at `smoke/**/*.smoke.test.ts`, sets `globalSetup: ["./smoke/global_setup.ts"]` and `testTimeout: 30_000`.

- [ ] **Step 3: Run the smoke suite**

Run: `npm run test:smoke`
Expected: PASS. All routes 200, no markers, health `ok`.

- [ ] **Step 4: Write `server/eslint.config.mjs`**

Flat config: `eslint-config-next`'s `core-web-vitals` plus `typescript-eslint`'s recommended-type-checked, ignoring `.next`, `node_modules` and `smoke/**` build artefacts. Install `eslint`, `eslint-config-next`, `typescript-eslint` as workspace-root devDependencies. If `eslint-config-next` fights the flat format on this version, fall back to `@eslint/js` + `typescript-eslint` alone and note the omission in the commit body — do not leave a `lint` script that does nothing (blueprint §12: a script that does not run is a claim, not a gate).

- [ ] **Step 5: Write `.github/workflows/server-ci.yml`**

```yaml
name: server-ci

on:
  push:
    paths: &paths
      - "server/**"
      - "docker-compose.yml"
      - ".github/workflows/server-ci.yml"
      # The drift test exists to fail when this file changes. A path filter that omits
      # it makes the test unreachable from the only edit that should trigger it.
      - "docs/07-privacy-and-compliance.md"
  pull_request:
    paths: *paths

jobs:
  gate:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: server/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build -w @peraplano/web
      - run: SMOKE_SKIP_BUILD=1 npm run test:smoke

  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 6: Commit**

```bash
git add server .github
git commit -m "ci(server): lint, typecheck, test, build, smoke and secret-scan gate"
```

---

## Task 18: Full verification

- [ ] **Step 1: Run everything, from `server/`**

```bash
npm run lint
npm run typecheck
npm test
npm run build -w @peraplano/web
npm run test:smoke
```

All five must pass. Paste the real output into the final report — not a summary of it.

- [ ] **Step 2: Re-prove the boot gate both ways**

Boot the standalone server with an empty compliance environment (expect a non-zero exit naming all six fields) and with a complete one (expect `Ready` and a marker-free `/en/privacy`).

- [ ] **Step 3: Re-prove the drift test detects drift**

Change one cell of §4's table in `docs/07-privacy-and-compliance.md`, run `npm test`, confirm the drift test fails with a row diff, then `git checkout` the doc.

- [ ] **Step 4: Confirm the fence held**

Grep the diff for anything outside it: no Postgres, Redis, broker, gateway, gRPC, auth, account, session, cookie or analytics code. `docs/07-privacy-and-compliance.md` must be unmodified in the final tree.

- [ ] **Step 5: Commit any fixes and report**

Report: spec and plan paths, branch, commit SHAs, the file tree, real command output, the six fail-loud fields still awaiting values, the §4 lifecycle-row gap from spec §13 item 2, and anything in the approved design that turned out to be wrong on contact.

---

## Self-Review

**Spec coverage.** §1 six routes → Tasks 8–13; three non-page routes → Tasks 4, 14. §2.1–2.6 stack → Task 1. §3 layout → Tasks 1–7. §4.0 derivation rule → each page task's catalog step. §4.1–4.6 → Tasks 13, 11, 8, 12, 10, 9. §5 config → Tasks 2, 14 (boot gate), 15 (`.env.example`). §6 drift test → Tasks 7, 8. §7 `libs/common` → Tasks 2, 3. §8 brand → Task 5. §9 container/compose/nginx → Tasks 15, 16. §10 testing → every task, plus 17. §11 CI → Task 17. §12/§13 → nothing built, restated in Task 18 Step 4 and the final report.

**Corrections made during review.** Task 8's original `docStatus` prop would have required the route handler to read `docs/07-privacy-and-compliance.md` at runtime — impossible, since the Docker build context is `server/` and `docs/` is not in it. Replaced with a catalog literal plus a drift assertion, which gives the same guarantee with no runtime file access. Task 14's health route originally answered 503 when degraded, which would have made the container's `HEALTHCHECK` restart-loop a half-configured dev deployment; corrected to 200 with `status: "degraded"`.

**Known soft spot.** Task 11 asserts a row count for privacy §7's control table. The source lists fourteen entries, and the plan's draft test says thirteen — the implementer is instructed to count the source and set the number to reality rather than adjusting the source. Flagged rather than guessed.
