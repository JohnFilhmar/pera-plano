# Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `mobile/` Expo app foundation — scaffold, tooling, design tokens, theme, fonts, local SQLite schema (all 19 tables), domain types, mappers, core repositories, entitlements, React Query wiring, and the 5-tab navigation shell — fully test-driven, so feature plans (m1–m3) build on stable, tested seams.

**Architecture:** A local-first Expo SDK ~54 React Native app (New Architecture, React Compiler ON) with expo-router file routing, NativeWind styling from a single palette, and an expo-sqlite database accessed only through repository modules under `lib/db/repos/`. React Query (persisted to AsyncStorage) is the server/async-state layer; repositories are the only DDL/DML surface — screens never touch SQL. There is no auth and no network dependency in this plan (local-first MVP, no login).

**Tech Stack:** Expo SDK ~54 (RN 0.81, React 19.1, TypeScript ~5.9 strict) · expo-router ~6 (typed routes) · NativeWind ^4.2 + tailwindcss ^3.4 · TanStack React Query ~5.90 + `@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister` · expo-sqlite · react-native-reanimated ~4.1 + react-native-worklets · react-native-svg ^15 + react-native-svg-transformer · lucide-react-native · @expo-google-fonts/inter · jest + jest-expo + @testing-library/react-native · better-sqlite3 (dev-only, jest sqlite adapter).

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW — exact names, signatures, routes, tables, tokens. A task may add private internals; it may not rename or reshape anything the contract defines.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers (tables, columns). TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants. This intentionally overrides STACK_BASIS §14's kebab-case filename convention.
- **Currency:** integer **centavos** everywhere (DB, logic). `₱1,234.56` formatting happens only at display. `type Centavos = number`.
- **Time:** epoch milliseconds (`number`) in code and DB (`INTEGER`); calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings generated client-side (`lib/ids.ts`, Task 8).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **No AI-attribution trailers or footers of any kind** (no `Co-Authored-By: Claude`, no "Generated with" lines).
- **TDD:** every behavior lands as red test → minimal implementation → green → commit. Never write implementation before its failing test.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`. Both must pass before every commit.
- **CNG (managed workflow):** never commit `mobile/android/` or `mobile/ios/` — native projects are regenerated (`expo prebuild --clean`). Keep them gitignored.
- **Working directory:** all commands run from `mobile/` (i.e., `d:\My Folder\pera-plano\mobile`) unless a step says otherwise.
- **DB access:** feature code never runs DDL and never inlines SQL outside `lib/db/`. Screens/hooks call repos only.

---

### Task 1: Expo scaffold + jest-expo harness

**Files:**
- Create: `mobile/` (via create-expo-app), `mobile/tsconfig.json` (replace), `mobile/babel.config.js` (minimal), `mobile/test_support/jest_setup.ts`, `mobile/package.json` (edit: main, scripts, jest block)
- Delete: `mobile/App.tsx`, `mobile/index.ts` (template entry — replaced by `expo-router/entry`)
- Test: `mobile/test_support/__tests__/harness.test.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a bootable Expo project where `npx jest --ci` and `npx tsc --noEmit` run green; jest module alias `@/*` → project root; jest mocks for `@react-native-async-storage/async-storage` and `expo-crypto` available to all later tests. Note: the app itself is not routable until Task 15 creates `app/` — that is expected; tests and typecheck are the gates until then.

**Steps:**

- [ ] From the repo root `d:\My Folder\pera-plano`, scaffold the app:
  ```
  npx create-expo-app@latest mobile --template blank-typescript
  ```
  If `pera-plano/` is not yet a git repository, run `git init` at the repo root. If create-expo-app created a nested `mobile/.git`, remove that nested `.git` directory so the monorepo root owns version control.
- [ ] `cd mobile`, then install SDK-matched runtime deps (expo install picks versions compatible with SDK ~54):
  ```
  npx expo install expo-router expo-status-bar expo-splash-screen expo-linking expo-constants expo-font expo-sqlite expo-crypto react-native-safe-area-context react-native-screens react-native-svg react-native-reanimated react-native-worklets @react-native-async-storage/async-storage @react-navigation/native @react-navigation/bottom-tabs
  ```
- [ ] Install npm-pinned runtime deps:
  ```
  npm install nativewind@^4.2.1 tailwindcss@^3.4.17 @tanstack/react-query@^5.90.0 @tanstack/react-query-persist-client@^5.90.0 @tanstack/query-async-storage-persister@^5.90.0 lucide-react-native @expo-google-fonts/inter
  ```
- [ ] Install dev deps (`react-test-renderer` MUST match the installed `react` version — check `package.json`, SDK 54 ships react 19.1.x):
  ```
  npm install --save-dev jest jest-expo @testing-library/react-native react-test-renderer@19.1.0 @types/jest better-sqlite3 @types/better-sqlite3 react-native-svg-transformer babel-plugin-inline-import babel-plugin-react-compiler babel-plugin-transform-remove-console
  ```
- [ ] Edit `package.json`: set the entry and scripts (leave dependency blocks as installed):
  ```json
  {
    "main": "expo-router/entry",
    "scripts": {
      "start": "expo start",
      "android": "expo run:android",
      "test": "jest --ci",
      "typecheck": "tsc --noEmit"
    }
  }
  ```
  Delete `App.tsx` and the template `index.ts` if present (expo-router owns the entry from here; routes arrive in Task 15).
- [ ] Replace `tsconfig.json`:
  ```json
  {
    "extends": "expo/tsconfig.base",
    "compilerOptions": {
      "strict": true,
      "paths": { "@/*": ["./*"] }
    },
    "include": [
      "**/*.ts",
      "**/*.tsx",
      ".expo/types/**/*.ts",
      "expo-env.d.ts",
      "nativewind-env.d.ts",
      "svg.d.ts",
      "sql.d.ts"
    ]
  }
  ```
  (The three `.d.ts` files are created in Task 3; tsc ignores include patterns that match nothing.)
- [ ] Create minimal `babel.config.js` (Task 3 replaces it with the full version):
  ```js
  module.exports = function (api) {
    api.cache(true);
    return { presets: ["babel-preset-expo"] };
  };
  ```
- [ ] Create `test_support/jest_setup.ts` — global jest mocks every later test relies on:
  ```ts
  // AsyncStorage has no native module under jest — use its official in-memory mock.
  jest.mock("@react-native-async-storage/async-storage", () =>
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
  );

  // expo-crypto is a native module; node's crypto provides the same UUIDv4 API.
  jest.mock("expo-crypto", () => ({
    randomUUID: () => require("crypto").randomUUID(),
  }));
  ```
- [ ] Write the failing harness test `test_support/__tests__/harness.test.tsx`:
  ```tsx
  import { render } from "@testing-library/react-native";
  import { Text } from "react-native";

  test("jest-expo harness renders a react-native component", () => {
    const { getByText } = render(<Text>PeraPlano</Text>);
    expect(getByText("PeraPlano")).toBeTruthy();
  });
  ```
- [ ] Run `npx jest --ci` — expected FAILURE: jest has no preset yet, so it cannot transform JSX/react-native imports (error mentions an unexpected token or unconfigured transform).
- [ ] Add the jest block to `package.json` (sibling of `"scripts"`):
  ```json
  {
    "jest": {
      "preset": "jest-expo",
      "setupFiles": ["<rootDir>/test_support/jest_setup.ts"],
      "moduleNameMapper": {
        "^@/(.*)$": "<rootDir>/$1"
      },
      "transformIgnorePatterns": [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|nativewind|react-native-css-interop|lucide-react-native))"
      ]
    }
  }
  ```
- [ ] Run `npx jest --ci` — expected PASS (1 test). Run `npx tsc --noEmit` — expected clean.
- [ ] Verify `.gitignore` (template ships one) contains `node_modules/`, `.expo/`, and add these lines if missing (CNG rule):
  ```
  android/
  ios/
  ```
- [ ] Commit (from repo root):
  ```
  git add mobile .gitignore
  git commit -m "feat(mobile): scaffold expo sdk 54 app with jest-expo harness"
  ```

---

### Task 2: Design tokens (`constants/colors.ts`) + env (`constants/env.ts`)

**Files:**
- Create: `mobile/constants/colors.ts`, `mobile/constants/env.ts`
- Test: `mobile/constants/__tests__/colors.test.ts`, `mobile/constants/__tests__/env.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const palette` (contract §2, verbatim — consumed by Task 3 tailwind config and Task 15 nav shell) and `export const ENV: { API_URL: string }` (consumed by m3's `services/parser_rules.ts` / `services/telemetry.ts`).

**Steps:**

- [ ] Write the failing palette test `constants/__tests__/colors.test.ts`:
  ```ts
  import { palette } from "../colors";

  test("every light token has a -dark sibling", () => {
    const keys = Object.keys(palette);
    const lightKeys = keys.filter((k) => !k.endsWith("-dark"));
    for (const key of lightKeys) {
      expect(keys).toContain(`${key}-dark`);
    }
  });

  test("contract §2 values are verbatim", () => {
    expect(palette.brand).toBe("#15803D");
    expect(palette["brand-dark"]).toBe("#22C55E");
    expect(palette["brand-soft"]).toBe("#DCFCE7");
    expect(palette["brand-soft-dark"]).toBe("#14261C");
    expect(palette.bg).toBe("#F7FAF7");
    expect(palette["bg-dark"]).toBe("#0B1210");
    expect(palette.surface).toBe("#FFFFFF");
    expect(palette["surface-dark"]).toBe("#111A16");
    expect(palette.fg).toBe("#10201A");
    expect(palette["fg-dark"]).toBe("#E8F0EC");
    expect(palette["fg-2"]).toBe("#5B6E64");
    expect(palette["fg-2-dark"]).toBe("#9BB0A6");
    expect(palette.danger).toBe("#DC2626");
    expect(palette["danger-dark"]).toBe("#F87171");
    expect(palette.warn).toBe("#D97706");
    expect(palette["warn-dark"]).toBe("#FBBF24");
    expect(palette["ph-blue"]).toBe("#0038A8");
    expect(palette["ph-blue-dark"]).toBe("#4D7CDB");
    expect(palette["ph-red"]).toBe("#CE1126");
    expect(palette["ph-red-dark"]).toBe("#E4566A");
    expect(palette["ph-yellow"]).toBe("#FCD116");
    expect(palette["ph-yellow-dark"]).toBe("#FCD116");
  });
  ```
- [ ] Run `npx jest --ci constants/__tests__/colors.test.ts` — expected FAILURE: `Cannot find module '../colors'`.
- [ ] Create `constants/colors.ts` — the contract §2 block, VERBATIM (single palette source; PH-flag colors are accent-only, brand green leads; icons are lucide, brand mark = `Send`):
  ```ts
  export const palette = {
    brand: "#15803D",        "brand-dark": "#22C55E",
    "brand-soft": "#DCFCE7", "brand-soft-dark": "#14261C",
    bg: "#F7FAF7",           "bg-dark": "#0B1210",
    surface: "#FFFFFF",      "surface-dark": "#111A16",
    fg: "#10201A",           "fg-dark": "#E8F0EC",
    "fg-2": "#5B6E64",       "fg-2-dark": "#9BB0A6",
    danger: "#DC2626",       "danger-dark": "#F87171",
    warn: "#D97706",         "warn-dark": "#FBBF24",
    "ph-blue": "#0038A8",    "ph-blue-dark": "#4D7CDB",
    "ph-red": "#CE1126",     "ph-red-dark": "#E4566A",
    "ph-yellow": "#FCD116",  "ph-yellow-dark": "#FCD116",
  } as const;
  ```
- [ ] Run `npx jest --ci constants/__tests__/colors.test.ts` — expected PASS.
- [ ] Write the failing env test `constants/__tests__/env.test.ts` (the module is re-required per test because it reads env at load time):
  ```ts
  describe("ENV", () => {
    const ORIGINAL = process.env.EXPO_PUBLIC_API_URL;

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = ORIGINAL;
      jest.resetModules();
    });

    test("falls back to the dev default when unset", () => {
      delete process.env.EXPO_PUBLIC_API_URL;
      jest.resetModules();
      const { ENV } = require("../env") as typeof import("../env");
      expect(ENV.API_URL).toBe("http://localhost:3000");
    });

    test("reads EXPO_PUBLIC_API_URL when set", () => {
      process.env.EXPO_PUBLIC_API_URL = "https://api.peraplano.example";
      jest.resetModules();
      const { ENV } = require("../env") as typeof import("../env");
      expect(ENV.API_URL).toBe("https://api.peraplano.example");
    });
  });
  ```
- [ ] Run `npx jest --ci constants/__tests__/env.test.ts` — expected FAILURE: `Cannot find module '../env'`.
- [ ] Create `constants/env.ts` — the ONLY place env is read (STACK_BASIS §13):
  ```ts
  export const ENV = {
    /** Server base URL. Set per EAS profile / .env as EXPO_PUBLIC_API_URL. */
    API_URL: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
  } as const;
  ```
- [ ] Run `npx jest --ci constants/__tests__/env.test.ts` — expected PASS. Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add constants
  git commit -m "feat(mobile): add palette design tokens and typed env constants"
  ```

---

### Task 3: Tooling configs — metro, babel, tailwind, global.css, app.json, type decls

**Files:**
- Create: `mobile/metro.config.js`, `mobile/tailwind.config.ts`, `mobile/global.css`, `mobile/nativewind-env.d.ts`, `mobile/svg.d.ts`, `mobile/sql.d.ts`
- Modify: `mobile/babel.config.js` (full version), `mobile/app.json` (replace template content)
- Test: `mobile/test_support/__tests__/tailwind_config.test.ts`

**Interfaces:**
- Consumes: `palette` from `@/constants/colors` (Task 2).
- Produces: NativeWind utilities (`bg-bg dark:bg-bg-dark`, `text-fg-2`, `bg-brand-soft`, …) consumed by every screen; `.sql` files importable as strings (consumed by Task 7); `.svg` files importable as components (feature plans); `app.json` with `userInterfaceStyle: "automatic"`, typed routes, React Compiler, themed splash.

**Steps:**

- [ ] Write the failing config test `test_support/__tests__/tailwind_config.test.ts`:
  ```ts
  import { palette } from "@/constants/colors";
  import config from "../../tailwind.config";

  type ColorScale = Record<string, string>;

  test("content globs are absolute real paths (junction-safe)", () => {
    const globs = config.content as string[];
    expect(globs.length).toBeGreaterThan(0);
    for (const glob of globs) {
      // POSIX absolute or Windows drive-letter absolute with forward slashes.
      expect(glob.startsWith("/") || /^[A-Za-z]:\//.test(glob)).toBe(true);
    }
  });

  test("every palette token is mapped into the tailwind color scales", () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, ColorScale>;
    expect(colors.bg.DEFAULT).toBe(palette.bg);
    expect(colors.bg.dark).toBe(palette["bg-dark"]);
    expect(colors.surface.DEFAULT).toBe(palette.surface);
    expect(colors.surface.dark).toBe(palette["surface-dark"]);
    expect(colors.fg.DEFAULT).toBe(palette.fg);
    expect(colors.fg.dark).toBe(palette["fg-dark"]);
    expect(colors.fg["2"]).toBe(palette["fg-2"]);
    expect(colors.fg["2-dark"]).toBe(palette["fg-2-dark"]);
    expect(colors.brand.DEFAULT).toBe(palette.brand);
    expect(colors.brand.dark).toBe(palette["brand-dark"]);
    expect(colors.brand.soft).toBe(palette["brand-soft"]);
    expect(colors.brand["soft-dark"]).toBe(palette["brand-soft-dark"]);
    expect(colors.danger.DEFAULT).toBe(palette.danger);
    expect(colors.danger.dark).toBe(palette["danger-dark"]);
    expect(colors.warn.DEFAULT).toBe(palette.warn);
    expect(colors.warn.dark).toBe(palette["warn-dark"]);
    expect(colors["ph-blue"].DEFAULT).toBe(palette["ph-blue"]);
    expect(colors["ph-blue"].dark).toBe(palette["ph-blue-dark"]);
    expect(colors["ph-red"].DEFAULT).toBe(palette["ph-red"]);
    expect(colors["ph-red"].dark).toBe(palette["ph-red-dark"]);
    expect(colors["ph-yellow"].DEFAULT).toBe(palette["ph-yellow"]);
    expect(colors["ph-yellow"].dark).toBe(palette["ph-yellow-dark"]);
  });

  test("nativewind preset and Inter font family are wired", () => {
    expect(config.presets?.length).toBe(1);
    const fonts = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>;
    expect(fonts.sans).toEqual(["Inter_400Regular"]);
  });
  ```
- [ ] Run `npx jest --ci test_support/__tests__/tailwind_config.test.ts` — expected FAILURE: `Cannot find module '../../tailwind.config'`.
- [ ] Create `tailwind.config.ts` — one token source, absolute real-path content globs (STACK_BASIS §3/§15: relative globs through a junction silently produce empty CSS and strip every NativeWind style from a release build):
  ```ts
  import fs from "fs";
  import type { Config } from "tailwindcss";
  import { palette } from "./constants/colors";

  const root = fs.realpathSync(__dirname).replace(/\\/g, "/");

  export default {
    content: [
      `${root}/app/**/*.{js,jsx,ts,tsx}`,
      `${root}/components/**/*.{js,jsx,ts,tsx}`,
    ],
    presets: [require("nativewind/preset")],
    theme: {
      extend: {
        fontFamily: { sans: ["Inter_400Regular"] },
        colors: {
          bg: { DEFAULT: palette.bg, dark: palette["bg-dark"] },
          surface: { DEFAULT: palette.surface, dark: palette["surface-dark"] },
          fg: {
            DEFAULT: palette.fg,
            dark: palette["fg-dark"],
            "2": palette["fg-2"],
            "2-dark": palette["fg-2-dark"],
          },
          brand: {
            DEFAULT: palette.brand,
            dark: palette["brand-dark"],
            soft: palette["brand-soft"],
            "soft-dark": palette["brand-soft-dark"],
          },
          danger: { DEFAULT: palette.danger, dark: palette["danger-dark"] },
          warn: { DEFAULT: palette.warn, dark: palette["warn-dark"] },
          "ph-blue": { DEFAULT: palette["ph-blue"], dark: palette["ph-blue-dark"] },
          "ph-red": { DEFAULT: palette["ph-red"], dark: palette["ph-red-dark"] },
          "ph-yellow": { DEFAULT: palette["ph-yellow"], dark: palette["ph-yellow-dark"] },
        },
      },
    },
    plugins: [],
  } satisfies Config;
  ```
- [ ] Run `npx jest --ci test_support/__tests__/tailwind_config.test.ts` — expected PASS.
- [ ] Create `global.css` (imported once, in the root layout — Task 15):
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  ```
- [ ] Create `metro.config.js` — realpathSync root + svg transformer + NativeWind, exactly per STACK_BASIS §3:
  ```js
  const { getDefaultConfig } = require("expo/metro-config");
  const { withNativeWind } = require("nativewind/metro");
  const fs = require("fs");
  const path = require("path");

  // realpath the root: needed when building from a junction/symlink (Windows
  // MAX_PATH workaround) so Metro emits correct paths and NativeWind resolves.
  const projectRoot = fs.realpathSync(__dirname);
  const config = getDefaultConfig(projectRoot);

  // Import .svg files as React components.
  config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer");
  config.resolver.assetExts = config.resolver.assetExts.filter((e) => e !== "svg");
  config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

  module.exports = withNativeWind(config, {
    input: path.join(projectRoot, "global.css"), // absolute, real-path
  });
  ```
- [ ] Replace `babel.config.js` with the full version (nativewind jsxImportSource; `.sql` files inlined as strings for the migration runner — works identically under Metro and babel-jest; console stripped from production bundles; the reanimated/worklets plugin is auto-added by babel-preset-expo since SDK 50, do NOT add it manually):
  ```js
  module.exports = function (api) {
    api.cache(true);
    return {
      presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
      plugins: [
        ["babel-plugin-inline-import", { extensions: [".sql"] }],
        // Strip console.* from production bundles.
        ...(process.env.NODE_ENV === "production" ? [["transform-remove-console"]] : []),
      ],
    };
  };
  ```
- [ ] Create the three ambient type declarations. `nativewind-env.d.ts`:
  ```ts
  /// <reference types="nativewind/types" />
  ```
  `svg.d.ts`:
  ```ts
  declare module "*.svg" {
    import type React from "react";
    import type { SvgProps } from "react-native-svg";
    const content: React.FC<SvgProps>;
    export default content;
  }
  ```
  `sql.d.ts`:
  ```ts
  declare module "*.sql" {
    const content: string;
    export default content;
  }
  ```
- [ ] Replace `app.json` per STACK_BASIS §2 — managed/CNG, automatic theme, typed routes + React Compiler experiments, themed splash (light `bg` #F7FAF7 / dark `bg-dark` #0B1210 from the palette), explicit (empty) Android permissions. OTA/`updates` config is deliberately deferred to EAS setup (it requires a real EAS project id — out of foundation scope). If the template lacks `assets/splash-icon.png`, substitute `./assets/icon.png` in both splash entries:
  ```json
  {
    "expo": {
      "name": "PeraPlano",
      "slug": "pera-plano",
      "version": "0.1.0",
      "orientation": "portrait",
      "icon": "./assets/icon.png",
      "scheme": "peraplano",
      "userInterfaceStyle": "automatic",
      "newArchEnabled": true,
      "splash": {
        "image": "./assets/splash-icon.png",
        "resizeMode": "contain",
        "backgroundColor": "#F7FAF7"
      },
      "android": {
        "package": "com.peraplano.app",
        "adaptiveIcon": {
          "foregroundImage": "./assets/adaptive-icon.png",
          "backgroundColor": "#F7FAF7"
        },
        "permissions": []
      },
      "experiments": {
        "typedRoutes": true,
        "reactCompiler": true
      },
      "plugins": [
        "expo-router",
        [
          "expo-splash-screen",
          {
            "image": "./assets/splash-icon.png",
            "imageWidth": 200,
            "backgroundColor": "#F7FAF7",
            "dark": {
              "image": "./assets/splash-icon.png",
              "backgroundColor": "#0B1210"
            }
          }
        ],
        "expo-sqlite",
        "expo-font"
      ]
    }
  }
  ```
- [ ] Verify the config parses and the experiments are on: run `npx expo config --type public` — output must include `"userInterfaceStyle": "automatic"` and no schema errors.
- [ ] Run `npx jest --ci` (all green) and `npx tsc --noEmit` (clean).
- [ ] Commit:
  ```
  git add metro.config.js babel.config.js tailwind.config.ts global.css app.json nativewind-env.d.ts svg.d.ts sql.d.ts test_support
  git commit -m "chore(mobile): wire metro, babel, tailwind, and app config per stack basis"
  ```

---

### Task 4: Inter font + app-wide Text/TextInput defaultProps patch

**Files:**
- Create: `mobile/lib/fonts.ts`
- Test: `mobile/lib/__tests__/fonts.test.ts`

**Interfaces:**
- Consumes: nothing (Inter faces were installed in Task 1 via `@expo-google-fonts/inter`).
- Produces: `APP_FONT_FAMILY: "Inter_400Regular"` and `applyGlobalFont(): void` — called once in the root layout (Task 15) BEFORE any render, per STACK_BASIS §4 (patch defaultProps once instead of styling every component). The tailwind `font-sans` family (Task 3) matches `APP_FONT_FAMILY`.

**Steps:**

- [ ] Write the failing test `lib/__tests__/fonts.test.ts`:
  ```ts
  import { Text, TextInput } from "react-native";
  import { APP_FONT_FAMILY, applyGlobalFont } from "../fonts";

  type PatchedComponent = { defaultProps?: { style?: unknown } };

  function familyOf(component: unknown): string | undefined {
    const style = (component as PatchedComponent).defaultProps?.style;
    const flat = Array.isArray(style)
      ? Object.assign({}, ...(style as object[]))
      : (style as object | undefined);
    return (flat as { fontFamily?: string } | undefined)?.fontFamily;
  }

  test("applyGlobalFont injects Inter into Text and TextInput defaultProps", () => {
    applyGlobalFont();
    expect(APP_FONT_FAMILY).toBe("Inter_400Regular");
    expect(familyOf(Text)).toBe(APP_FONT_FAMILY);
    expect(familyOf(TextInput)).toBe(APP_FONT_FAMILY);
  });

  test("applyGlobalFont is idempotent — no duplicate style layers", () => {
    applyGlobalFont();
    applyGlobalFont();
    const style = (Text as unknown as PatchedComponent).defaultProps?.style;
    const layers = Array.isArray(style) ? style : [style];
    const fontLayers = layers.filter(
      (l) => (l as { fontFamily?: string } | undefined)?.fontFamily === APP_FONT_FAMILY,
    );
    expect(fontLayers).toHaveLength(1);
  });
  ```
- [ ] Run `npx jest --ci lib/__tests__/fonts.test.ts` — expected FAILURE: `Cannot find module '../fonts'`.
- [ ] Create `lib/fonts.ts`:
  ```ts
  import { Text, TextInput } from "react-native";

  /** The loaded Inter face NativeWind's `font-sans` and all default text uses. */
  export const APP_FONT_FAMILY = "Inter_400Regular";

  type PatchableComponent = {
    defaultProps?: { style?: unknown } & Record<string, unknown>;
  };

  let applied = false;

  /**
   * App-wide font: patch Text/TextInput defaultProps once at module load
   * (STACK_BASIS §4) so every component renders Inter without per-component
   * styling. Existing defaultProps styles are preserved underneath.
   */
  export function applyGlobalFont(): void {
    if (applied) return;
    applied = true;
    for (const component of [Text, TextInput] as unknown as PatchableComponent[]) {
      const defaults = component.defaultProps ?? {};
      const existingStyle = defaults.style;
      component.defaultProps = {
        ...defaults,
        style: existingStyle
          ? [{ fontFamily: APP_FONT_FAMILY }, existingStyle]
          : { fontFamily: APP_FONT_FAMILY },
      };
    }
  }
  ```
- [ ] Run `npx jest --ci lib/__tests__/fonts.test.ts` — expected PASS. Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib
  git commit -m "feat(mobile): add inter font constant and global text defaultProps patch"
  ```

---

### Task 5: `useTheme` — auto/light/dark, persisted

**Files:**
- Create: `mobile/contexts/theme_context.tsx`
- Test: `mobile/contexts/__tests__/theme_context.test.tsx`

**Interfaces:**
- Consumes: AsyncStorage (mocked in jest via Task 1 setup), `colorScheme` from `nativewind`.
- Produces (consumed by Task 15 and all feature screens):
  ```ts
  export type ThemePreference = "auto" | "light" | "dark";
  export type ResolvedTheme = "light" | "dark";
  export function ThemeProvider(props: { children: ReactNode }): JSX.Element;
  export function useTheme(): {
    preference: ThemePreference;   // what the user chose (default "auto")
    resolved: ResolvedTheme;       // preference resolved against the system scheme
    setPreference(p: ThemePreference): void; // persists to AsyncStorage
    isReady: boolean;              // true once the persisted preference has loaded
  };
  ```

**Steps:**

- [ ] Write the failing test `contexts/__tests__/theme_context.test.tsx`:
  ```tsx
  import AsyncStorage from "@react-native-async-storage/async-storage";
  import { act, renderHook, waitFor } from "@testing-library/react-native";
  import type { ReactNode } from "react";
  import { ThemeProvider, useTheme } from "../theme_context";

  jest.mock("nativewind", () => ({ colorScheme: { set: jest.fn() } }));

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider>{children}</ThemeProvider>
  );

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  test("defaults to auto and resolves from the system scheme", async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.preference).toBe("auto");
    expect(["light", "dark"]).toContain(result.current.resolved);
  });

  test("setPreference resolves immediately and persists", async () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.setPreference("dark"));
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("peraplano.theme_preference")).toBe("dark"),
    );
  });

  test("restores a persisted preference on mount", async () => {
    await AsyncStorage.setItem("peraplano.theme_preference", "dark");
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.preference).toBe("dark"));
    expect(result.current.resolved).toBe("dark");
  });

  test("pushes the preference into nativewind so dark: variants track it", async () => {
    const { colorScheme } = jest.requireMock("nativewind") as {
      colorScheme: { set: jest.Mock };
    };
    const { result } = renderHook(() => useTheme(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.setPreference("light"));
    expect(colorScheme.set).toHaveBeenLastCalledWith("light");
    act(() => result.current.setPreference("auto"));
    expect(colorScheme.set).toHaveBeenLastCalledWith("system");
  });

  test("useTheme outside ThemeProvider throws", () => {
    // Silence React's error boundary noise for this expected throw.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      "useTheme must be used within ThemeProvider",
    );
    spy.mockRestore();
  });
  ```
- [ ] Run `npx jest --ci contexts/__tests__/theme_context.test.tsx` — expected FAILURE: `Cannot find module '../theme_context'`.
- [ ] Create `contexts/theme_context.tsx`:
  ```tsx
  import AsyncStorage from "@react-native-async-storage/async-storage";
  import { colorScheme as nativewindColorScheme } from "nativewind";
  import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
  } from "react";
  import { useColorScheme as useSystemColorScheme } from "react-native";

  export type ThemePreference = "auto" | "light" | "dark";
  export type ResolvedTheme = "light" | "dark";

  const STORAGE_KEY = "peraplano.theme_preference";

  type ThemeContextValue = {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setPreference: (p: ThemePreference) => void;
    isReady: boolean;
  };

  const ThemeContext = createContext<ThemeContextValue | null>(null);

  export function ThemeProvider({ children }: { children: ReactNode }) {
    const system = useSystemColorScheme(); // "light" | "dark" | null
    const [preference, setPreferenceState] = useState<ThemePreference>("auto");
    const [isReady, setIsReady] = useState(false);

    // Restore the persisted preference once on mount.
    useEffect(() => {
      AsyncStorage.getItem(STORAGE_KEY)
        .then((stored) => {
          if (stored === "auto" || stored === "light" || stored === "dark") {
            setPreferenceState(stored);
          }
        })
        .finally(() => setIsReady(true));
    }, []);

    // Drive NativeWind's dark: variant from the preference.
    useEffect(() => {
      nativewindColorScheme.set(preference === "auto" ? "system" : preference);
    }, [preference]);

    const setPreference = useCallback((p: ThemePreference) => {
      setPreferenceState(p);
      void AsyncStorage.setItem(STORAGE_KEY, p);
    }, []);

    const resolved: ResolvedTheme =
      preference === "auto" ? (system === "dark" ? "dark" : "light") : preference;

    const value = useMemo(
      () => ({ preference, resolved, setPreference, isReady }),
      [preference, resolved, setPreference, isReady],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  }

  export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
  }
  ```
- [ ] Run `npx jest --ci contexts/__tests__/theme_context.test.tsx` — expected PASS. Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add contexts
  git commit -m "feat(mobile): add persisted auto/light/dark theme context"
  ```

---

### Task 6: expo-sqlite database handle + numbered migration runner

**Files:**
- Create: `mobile/test_support/expo_sqlite_mock.ts`, `mobile/lib/db/database.ts`, `mobile/lib/db/migrations.ts`
- Modify: `mobile/package.json` (jest `moduleNameMapper` gains the expo-sqlite mock)
- Test: `mobile/lib/db/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: better-sqlite3 (dev dep, Task 1).
- Produces (consumed by Tasks 7–12 and every feature plan):
  ```ts
  // lib/db/database.ts
  export function getDatabase(): Promise<SQLiteDatabase>;   // singleton; PRAGMA foreign_keys ON
  export function closeDatabase(): Promise<void>;           // closes + clears singleton (tests)
  // lib/db/migrations.ts
  export type Migration = { version: number; name: string; sql: string };
  export const MIGRATIONS: Migration[];                     // registry; Task 7 adds 001_core
  export function runMigrations(db: SQLiteDatabase, migrations?: Migration[]): Promise<number[]>; // returns newly applied versions
  ```
  The runner owns the `schema_migrations` bookkeeping table (`version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER`) — it is NOT one of the 19 contract tables.

**Steps:**

- [ ] Create `test_support/expo_sqlite_mock.ts` — a better-sqlite3 adapter exposing the subset of the expo-sqlite async API the app uses, so repos and migrations run against a real in-memory SQLite under jest. Every `openDatabaseAsync` call returns a FRESH `:memory:` database (test isolation):
  ```ts
  // Jest stand-in for expo-sqlite (native module). Mapped via jest moduleNameMapper.
  // Implements only the async API surface PeraPlano uses.
  import Database from "better-sqlite3";

  export type SQLiteRunResult = { lastInsertRowId: number; changes: number };

  type BindValue = string | number | null;
  type BindArgs = BindValue[] | [BindValue[]];

  function flatten(params: BindArgs): BindValue[] {
    return params.length === 1 && Array.isArray(params[0])
      ? (params[0] as BindValue[])
      : (params as BindValue[]);
  }

  export class SQLiteDatabase {
    private db: InstanceType<typeof Database>;

    constructor() {
      this.db = new Database(":memory:");
    }

    async execAsync(sql: string): Promise<void> {
      this.db.exec(sql);
    }

    async runAsync(sql: string, ...params: BindArgs): Promise<SQLiteRunResult> {
      const info = this.db.prepare(sql).run(...flatten(params));
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    }

    async getFirstAsync<T>(sql: string, ...params: BindArgs): Promise<T | null> {
      const row = this.db.prepare(sql).get(...flatten(params)) as T | undefined;
      return row ?? null;
    }

    async getAllAsync<T>(sql: string, ...params: BindArgs): Promise<T[]> {
      return this.db.prepare(sql).all(...flatten(params)) as T[];
    }

    async withTransactionAsync(work: () => Promise<void>): Promise<void> {
      // better-sqlite3's .transaction() rejects async fns; drive BEGIN/COMMIT manually.
      this.db.exec("BEGIN");
      try {
        await work();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }

    async closeAsync(): Promise<void> {
      this.db.close();
    }
  }

  export async function openDatabaseAsync(_name: string): Promise<SQLiteDatabase> {
    return new SQLiteDatabase();
  }
  ```
- [ ] Add the mapping to the jest block in `package.json` (`moduleNameMapper` now has two entries):
  ```json
  {
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/$1",
      "^expo-sqlite$": "<rootDir>/test_support/expo_sqlite_mock.ts"
    }
  }
  ```
- [ ] Write the failing test `lib/db/__tests__/migrations.test.ts`:
  ```ts
  import { closeDatabase, getDatabase } from "../database";
  import { runMigrations, type Migration } from "../migrations";

  const TEST_MIGRATIONS: Migration[] = [
    { version: 1, name: "one", sql: "CREATE TABLE t_one (id TEXT PRIMARY KEY);" },
    { version: 2, name: "two", sql: "CREATE TABLE t_two (id TEXT PRIMARY KEY);" },
  ];

  afterEach(async () => {
    await closeDatabase();
  });

  test("applies pending migrations in version order and records them", async () => {
    const db = await getDatabase();
    const applied = await runMigrations(db, TEST_MIGRATIONS);
    expect(applied).toEqual([1, 2]);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["schema_migrations", "t_one", "t_two"]),
    );
    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual([
      { version: 1, name: "one" },
      { version: 2, name: "two" },
    ]);
  });

  test("is idempotent — a second run applies nothing", async () => {
    const db = await getDatabase();
    await runMigrations(db, TEST_MIGRATIONS);
    const second = await runMigrations(db, TEST_MIGRATIONS);
    expect(second).toEqual([]);
  });

  test("applies only migrations newer than the recorded ones", async () => {
    const db = await getDatabase();
    await runMigrations(db, [TEST_MIGRATIONS[0]]);
    const applied = await runMigrations(db, TEST_MIGRATIONS);
    expect(applied).toEqual([2]);
  });

  test("a failing migration rolls back and records nothing for it", async () => {
    const db = await getDatabase();
    const bad: Migration[] = [
      { version: 1, name: "bad", sql: "CREATE TABLE broken (id TEXT PRIMARY KEY); INSERT INTO nonexistent VALUES (1);" },
    ];
    await expect(runMigrations(db, bad)).rejects.toThrow();
    const recorded = await db.getAllAsync<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    expect(recorded).toEqual([]);
  });

  test("getDatabase turns PRAGMA foreign_keys ON and is a singleton", async () => {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(row?.foreign_keys).toBe(1);
    expect(await getDatabase()).toBe(db);
  });
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/migrations.test.ts` — expected FAILURE: `Cannot find module '../database'`.
- [ ] Create `lib/db/database.ts`:
  ```ts
  import * as SQLite from "expo-sqlite";
  import type { SQLiteDatabase } from "expo-sqlite";

  const DB_NAME = "peraplano.db";

  let dbPromise: Promise<SQLiteDatabase> | null = null;

  async function open(): Promise<SQLiteDatabase> {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    // Contract §3: foreign keys are always enforced.
    await db.execAsync("PRAGMA foreign_keys = ON;");
    return db;
  }

  /** Singleton database handle. All repos go through this. */
  export function getDatabase(): Promise<SQLiteDatabase> {
    if (!dbPromise) dbPromise = open();
    return dbPromise;
  }

  /** Close and forget the handle. Used by tests for per-test isolation. */
  export async function closeDatabase(): Promise<void> {
    if (!dbPromise) return;
    const db = await dbPromise;
    dbPromise = null;
    await db.closeAsync();
  }
  ```
- [ ] Create `lib/db/migrations.ts`:
  ```ts
  import type { SQLiteDatabase } from "expo-sqlite";

  export type Migration = { version: number; name: string; sql: string };

  /**
   * Registry of numbered migrations, ascending. Task 7 registers 001_core.
   * NEVER edit a shipped migration — add a new numbered one instead.
   */
  export const MIGRATIONS: Migration[] = [];

  /**
   * Applies every migration whose version is not yet in schema_migrations,
   * each inside its own transaction. Returns the versions applied this run.
   */
  export async function runMigrations(
    db: SQLiteDatabase,
    migrations: Migration[] = MIGRATIONS,
  ): Promise<number[]> {
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at INTEGER NOT NULL
       );`,
    );
    const rows = await db.getAllAsync<{ version: number }>(
      "SELECT version FROM schema_migrations",
    );
    const done = new Set(rows.map((r) => r.version));
    const pending = [...migrations]
      .sort((a, b) => a.version - b.version)
      .filter((m) => !done.has(m.version));

    const applied: number[] = [];
    for (const migration of pending) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(migration.sql);
        await db.runAsync(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          [migration.version, migration.name, Date.now()],
        );
      });
      applied.push(migration.version);
    }
    return applied;
  }
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/migrations.test.ts` — expected PASS (5 tests). Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib/db test_support package.json
  git commit -m "feat(mobile): add sqlite database handle and numbered migration runner"
  ```

---

### Task 7: `001_core.sql` — all 19 contract tables

**Files:**
- Create: `mobile/lib/db/migrations/001_core.sql`, `mobile/test_support/db.ts`
- Modify: `mobile/lib/db/migrations.ts` (register the migration)
- Test: `mobile/lib/db/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `runMigrations`/`MIGRATIONS` (Task 6); `.sql`-as-string imports (Task 3 babel plugin + `sql.d.ts`).
- Produces: the full core schema — tables `wallets`, `wallet_matchers`, `transactions`, `transfer_links`, `categories`, `limits`, `income_profiles`, `income_profile_sources`, `goals`, `loans`, `loan_payments`, `bills`, `bill_payments`, `recurring_patterns`, `user_rules`, `review_queue_items`, `raw_notifications`, `parser_rulesets`, `app_settings` (contract §3) — plus `test_support/db.ts` `freshDb(): Promise<SQLiteDatabase>` used by every repo test. Feature plans NEVER run DDL; they use repositories over this schema.

**Schema derivation notes (from `docs/02-domain-model.md`, camelCase → snake_case):**
- Money = `INTEGER` centavos; timestamps = `INTEGER` epoch ms; calendar dates = `TEXT 'YYYY-MM-DD'`; booleans = `INTEGER 0/1`; fractions (confidence) = `REAL 0..1`; structured lists/objects = `*_json TEXT` (JSON-encoded).
- Enum values are stored exactly as the domain doc spells them (`'e-wallet'`, `'percent-of-income'`, `'i-owe'`, `'kinsenas'`, …).
- `limits.value` semantics: basis `'fixed'` → centavos; basis `'percent-of-income'` → percent × 100 as an integer (12.5% stored as `1250`) so no floats ever hold money-adjacent values. Documented on the `Limit` domain type (Task 8).
- `Wallet.matchers[]` normalizes into `wallet_matchers`; `IncomeProfile.sourceWalletIds[]` into `income_profile_sources`; `Loan.paymentHistory[]` into `loan_payments`; per-cycle Bill payment matches into `bill_payments` (a Transaction matches at most one cycle — `UNIQUE(transaction_id)`, invariant I12).
- `transactions`, `transfer_links`, `review_queue_items`, `raw_notifications` use the EXACT contract §3 column lists.
- Circular reference `transactions.transfer_link_id` ⇄ `transfer_links.*_transaction_id` is legal in SQLite: FK targets are resolved at DML time, and NULL FK values are never checked. Insert order at runtime: legs first (NULL link), then the link row, then UPDATE the legs.

**Steps:**

- [ ] Create `test_support/db.ts` — the shared per-test DB helper:
  ```ts
  import { closeDatabase, getDatabase } from "@/lib/db/database";
  import { runMigrations } from "@/lib/db/migrations";
  import type { SQLiteDatabase } from "expo-sqlite";

  /** Fresh in-memory DB with the full schema applied. Call in beforeEach. */
  export async function freshDb(): Promise<SQLiteDatabase> {
    await closeDatabase();
    const db = await getDatabase();
    await runMigrations(db);
    return db;
  }
  ```
- [ ] Write the failing test `lib/db/__tests__/schema.test.ts`:
  ```ts
  import { closeDatabase } from "../database";
  import { freshDb } from "@/test_support/db";

  const EXPECTED_TABLES = [
    "app_settings", "bill_payments", "bills", "categories", "goals",
    "income_profile_sources", "income_profiles", "limits", "loan_payments",
    "loans", "parser_rulesets", "raw_notifications", "recurring_patterns",
    "review_queue_items", "transactions", "transfer_links", "user_rules",
    "wallet_matchers", "wallets",
  ];

  afterEach(async () => {
    await closeDatabase();
  });

  test("001_core creates exactly the 19 contract tables", async () => {
    const db = await freshDb();
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
    expect(EXPECTED_TABLES).toHaveLength(19);
  });

  test("transactions has the exact contract §3 columns in order", async () => {
    const db = await freshDb();
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
    expect(cols.map((c) => c.name)).toEqual([
      "id", "wallet_id", "category_id", "amount", "direction", "occurred_at",
      "merchant", "counterparty", "reference_no", "source", "confidence",
      "raw_notification_id", "transfer_link_id", "note", "created_at", "updated_at",
    ]);
  });

  test("review_queue_items and raw_notifications match contract §3 columns", async () => {
    const db = await freshDb();
    const rq = await db.getAllAsync<{ name: string }>("PRAGMA table_info(review_queue_items)");
    expect(rq.map((c) => c.name)).toEqual([
      "id", "kind", "payload_json", "raw_notification_id", "created_at", "expires_at", "resolved_at",
    ]);
    const rn = await db.getAllAsync<{ name: string }>("PRAGMA table_info(raw_notifications)");
    expect(rn.map((c) => c.name)).toEqual([
      "id", "package_name", "title", "text", "sub_text", "big_text", "posted_at", "captured_at", "expires_at",
    ]);
  });

  test("transfer_links carries the contract §3 pinned columns", async () => {
    const db = await freshDb();
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transfer_links)");
    const names = cols.map((c) => c.name);
    for (const required of ["id", "out_transaction_id", "in_transaction_id", "fee_amount", "status"]) {
      expect(names).toContain(required);
    }
  });

  test("foreign keys are enforced", async () => {
    const db = await freshDb();
    await expect(
      db.runAsync(
        "INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at) VALUES ('t1', 'missing_wallet', 'missing_category', 100, 'out', 0, 'manual', 1.0, 0, 0)",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  test("CHECK constraints reject non-positive amounts and bad enums (invariant I6)", async () => {
    const db = await freshDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES ('w1', 'GCash', 'e-wallet', 0, 'PHP', 0, ?, ?)",
      [now, now],
    );
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('c1', 'Uncategorized', NULL, 'circle-help', 1, 0, ?, ?)",
      [now, now],
    );
    await expect(
      db.runAsync(
        "INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at) VALUES ('t1', 'w1', 'c1', 0, 'out', 0, 'manual', 1.0, 0, 0)",
      ),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db.runAsync(
        "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES ('w2', 'Bad', 'checking', 0, 'PHP', 0, 0, 0)",
      ),
    ).rejects.toThrow(/CHECK/i);
  });
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/schema.test.ts` — expected FAILURE: the first test finds 0 tables (nothing registered in `MIGRATIONS`).
- [ ] Create `lib/db/migrations/001_core.sql`:
  ```sql
  -- 001_core.sql — PeraPlano core schema (interface contract §3; docs/02-domain-model.md).
  -- Conventions: money INTEGER centavos · *_at INTEGER epoch ms · *_date TEXT 'YYYY-MM-DD'
  --              booleans INTEGER 0/1 · fractions REAL 0..1 · *_json TEXT (JSON-encoded).

  CREATE TABLE wallets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bank', 'e-wallet', 'cash', 'credit', 'savings')),
    balance INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PHP',
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE wallet_matchers (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    package_name TEXT NOT NULL,
    hint TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_wallet_matchers_wallet ON wallet_matchers(wallet_id);

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES categories(id),
    icon TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE raw_notifications (
    id TEXT PRIMARY KEY,
    package_name TEXT NOT NULL,
    title TEXT,
    text TEXT,
    sub_text TEXT,
    big_text TEXT,
    posted_at INTEGER NOT NULL,
    captured_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    category_id TEXT NOT NULL REFERENCES categories(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    occurred_at INTEGER NOT NULL,
    merchant TEXT,
    counterparty TEXT,
    reference_no TEXT,
    source TEXT NOT NULL CHECK (source IN ('notification', 'manual', 'recurring-rule', 'import')),
    confidence REAL NOT NULL DEFAULT 1.0,
    raw_notification_id TEXT REFERENCES raw_notifications(id),
    transfer_link_id TEXT REFERENCES transfer_links(id),
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_transactions_wallet ON transactions(wallet_id);
  CREATE INDEX idx_transactions_category ON transactions(category_id);
  CREATE INDEX idx_transactions_occurred ON transactions(occurred_at);

  CREATE TABLE transfer_links (
    id TEXT PRIMARY KEY,
    out_transaction_id TEXT NOT NULL REFERENCES transactions(id),
    in_transaction_id TEXT NOT NULL REFERENCES transactions(id),
    fee_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dissolved')),
    detected_by TEXT NOT NULL DEFAULT 'manual' CHECK (detected_by IN ('auto', 'manual')),
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE limits (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('daily', 'weekly', 'monthly', 'annual')),
    basis TEXT NOT NULL CHECK (basis IN ('fixed', 'percent-of-income')),
    value INTEGER NOT NULL CHECK (value > 0),
    category_filter_json TEXT,
    wallet_filter_json TEXT,
    rollover INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    thresholds_fired_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE income_profiles (
    id TEXT PRIMARY KEY,
    cadence TEXT NOT NULL CHECK (cadence IN ('kinsenas', 'weekly', 'monthly', 'irregular')),
    average_amount INTEGER,
    is_manual_override INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE income_profile_sources (
    id TEXT PRIMARY KEY,
    income_profile_id TEXT NOT NULL REFERENCES income_profiles(id),
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (income_profile_id, wallet_id)
  );

  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL CHECK (target_amount > 0),
    target_date TEXT,
    linked_wallet_id TEXT NOT NULL REFERENCES wallets(id),
    contribution_rule_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE loans (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('i-owe', 'owed-to-me')),
    counterparty TEXT NOT NULL,
    principal INTEGER NOT NULL CHECK (principal > 0),
    interest_rate REAL,
    schedule_json TEXT,
    linked_wallet_id TEXT REFERENCES wallets(id),
    next_due_date TEXT,
    next_due_amount INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE loan_payments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id),
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE bills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    amount_mode TEXT NOT NULL CHECK (amount_mode IN ('fixed', 'estimated')),
    due_rule_json TEXT NOT NULL,
    reminder_offsets_json TEXT NOT NULL DEFAULT '[]',
    auto_match_rule_json TEXT,
    category_id TEXT NOT NULL REFERENCES categories(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE bill_payments (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
    cycle_due_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (bill_id, cycle_due_date)
  );

  CREATE TABLE recurring_patterns (
    id TEXT PRIMARY KEY,
    merchant TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'annual')),
    confidence REAL NOT NULL DEFAULT 0,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE user_rules (
    id TEXT PRIMARY KEY,
    matcher_json TEXT NOT NULL,
    action_json TEXT NOT NULL,
    priority INTEGER NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_from TEXT,
    applied_count INTEGER NOT NULL DEFAULT 0,
    last_applied_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE review_queue_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate')),
    payload_json TEXT NOT NULL,
    raw_notification_id TEXT REFERENCES raw_notifications(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    resolved_at INTEGER
  );
  CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);

  CREATE TABLE parser_rulesets (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    installed_at INTEGER NOT NULL
  );

  CREATE TABLE app_settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ```
- [ ] Register it in `lib/db/migrations.ts` — add the import at the top and fill the registry:
  ```ts
  import coreSql from "./migrations/001_core.sql";
  ```
  ```ts
  export const MIGRATIONS: Migration[] = [
    { version: 1, name: "core", sql: coreSql },
  ];
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/schema.test.ts` — expected PASS (6 tests). Also run `npx jest --ci lib/db/__tests__/migrations.test.ts` — still green (runner tests use explicit test migrations, unaffected by the registry).
- [ ] Run `npx jest --ci` and `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add lib/db test_support
  git commit -m "feat(mobile): add 001_core migration creating all 19 contract tables"
  ```

---

### Task 8: Domain types, UUID helper, row<->domain mappers

**Files:**
- Create: `mobile/types/domain.ts`, `mobile/lib/ids.ts`, `mobile/lib/db/mappers.ts`
- Test: `mobile/lib/__tests__/ids.test.ts`, `mobile/lib/db/__tests__/mappers.test.ts`

**Interfaces:**
- Consumes: schema semantics from Task 7 (column names/encodings).
- Produces (consumed by every repo and every feature plan):
  - `types/domain.ts`: `Centavos`, `Wallet`, `NewWallet`, `WalletMatcher`, `Transaction`, `NewTransaction`, `TxFilter`, `TransferLink`, `Category`, `Limit`, `IncomeProfile`, `Goal`, `Loan`, `Bill`, `RecurringPattern`, `UserRule`, `ReviewQueueItem`, `NewReviewItem`, `ReviewResolution`, `RawCapture` + supporting enums/types — camelCase mirrors of the snake_case columns (contract §3).
  - `lib/ids.ts`: `newId(): string` (UUIDv4).
  - `lib/db/mappers.ts`: `WalletRow`/`rowToWallet`/`walletToRow`, `TransactionRow`/`rowToTransaction`/`transactionToRow`, `CategoryRow`/`rowToCategory`/`categoryToRow`, `ReviewQueueItemRow`/`rowToReviewQueueItem`/`reviewQueueItemToRow`. (Foundation maps the aggregates its repos use; feature plans extend this same file for theirs.)

**Steps:**

- [ ] Write the failing UUID test `lib/__tests__/ids.test.ts`:
  ```ts
  import { newId } from "../ids";

  const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test("newId returns RFC 4122 v4 UUIDs", () => {
    expect(newId()).toMatch(UUID_V4);
  });

  test("newId does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
  ```
- [ ] Run `npx jest --ci lib/__tests__/ids.test.ts` — expected FAILURE: `Cannot find module '../ids'`.
- [ ] Create `lib/ids.ts` (jest resolves the expo-crypto mock from Task 1's setup; on-device it is the native implementation):
  ```ts
  import * as Crypto from "expo-crypto";

  /** UUIDv4, generated client-side (interface contract §1). */
  export function newId(): string {
    return Crypto.randomUUID();
  }
  ```
- [ ] Run `npx jest --ci lib/__tests__/ids.test.ts` — expected PASS.
- [ ] Create `types/domain.ts` — the complete domain vocabulary. No test of its own (types are exercised by the mapper and repo tests), but `npx tsc --noEmit` gates it:
  ```ts
  // types/domain.ts — camelCase mirrors of the snake_case schema in 001_core.sql.
  // Owned by the foundation plan (interface contract §3). Feature plans import from here.

  /** Integer centavos — ₱1,234.56 is 123456. Never store or compute pesos as floats. */
  export type Centavos = number;

  /** Epoch milliseconds. */
  export type EpochMs = number;

  /** Calendar date as 'YYYY-MM-DD'. */
  export type IsoDate = string;

  // ---------- Wallet ----------
  export type WalletType = "bank" | "e-wallet" | "cash" | "credit" | "savings";

  export type Wallet = {
    id: string;
    name: string;
    type: WalletType;
    balance: Centavos;
    currency: "PHP";
    isArchived: boolean;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  export type NewWallet = {
    name: string;
    type: WalletType;
    /** Opening balance anchor (docs/02-domain-model.md §3.1); defaults to 0. */
    openingBalance?: Centavos;
  };

  /** One notification-source route into a Wallet (wallet_matchers table). */
  export type WalletMatcher = {
    id: string;
    walletId: string;
    packageName: string;
    hint: string | null;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Transaction ----------
  export type TxDirection = "in" | "out";
  export type TxSource = "notification" | "manual" | "recurring-rule" | "import";

  export type Transaction = {
    id: string;
    walletId: string;
    categoryId: string;
    amount: Centavos;
    direction: TxDirection;
    occurredAt: EpochMs;
    merchant: string | null;
    counterparty: string | null;
    referenceNo: string | null;
    source: TxSource;
    /** Parse confidence 0..1 at commit time; manual entries are 1.0. */
    confidence: number;
    rawNotificationId: string | null;
    transferLinkId: string | null;
    note: string | null;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  export type NewTransaction = {
    walletId: string;
    categoryId: string;
    amount: Centavos;
    direction: TxDirection;
    occurredAt: EpochMs;
    merchant?: string | null;
    counterparty?: string | null;
    referenceNo?: string | null;
    source: TxSource;
    confidence: number;
    rawNotificationId?: string | null;
    transferLinkId?: string | null;
    note?: string | null;
  };

  /** Contract §3 pinned filter for listTransactions. */
  export type TxFilter = {
    walletId?: string;
    categoryId?: string;
    from?: EpochMs;
    to?: EpochMs;
    direction?: TxDirection;
    excludeTransferLinked?: boolean;
  };

  // ---------- TransferLink ----------
  export type TransferLinkStatus = "active" | "dissolved";

  export type TransferLink = {
    id: string;
    outTransactionId: string;
    inTransactionId: string;
    /** outLeg.amount − inLeg.amount; negative = credited bonus (domain §3.3). */
    feeAmount: Centavos;
    status: TransferLinkStatus;
    detectedBy: "auto" | "manual";
    confidence: number;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Category ----------
  export type Category = {
    id: string;
    name: string;
    parentId: string | null;
    /** Lucide icon name (the app's brand icon family). */
    icon: string;
    isSystem: boolean;
    isHidden: boolean;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Limit ----------
  export type LimitScope = "daily" | "weekly" | "monthly" | "annual";
  export type LimitBasis = "fixed" | "percent-of-income";
  export type LimitThreshold = 50 | 80 | 100;

  export type Limit = {
    id: string;
    scope: LimitScope;
    basis: LimitBasis;
    /**
     * basis 'fixed': centavos. basis 'percent-of-income': percent × 100 as an
     * integer (12.5% -> 1250). Kept integer so nothing money-adjacent is a float.
     */
    value: number;
    categoryFilter: string[] | null;
    walletFilter: string[] | null;
    rollover: boolean;
    isActive: boolean;
    thresholdsFired: LimitThreshold[];
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- IncomeProfile ----------
  export type IncomeCadence = "kinsenas" | "weekly" | "monthly" | "irregular";

  export type IncomeProfile = {
    id: string;
    cadence: IncomeCadence;
    averageAmount: Centavos | null;
    /** Normalized into the income_profile_sources table. */
    sourceWalletIds: string[];
    isManualOverride: boolean;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Goal ----------
  export type ContributionRule =
    | { kind: "fixed"; amount: Centavos }
    | { kind: "percent"; percent: number };

  export type Goal = {
    id: string;
    name: string;
    targetAmount: Centavos;
    targetDate: IsoDate | null;
    /** Must reference a Wallet of type 'savings' (invariant I10). */
    linkedWalletId: string;
    contributionRule: ContributionRule | null;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Loan ----------
  export type LoanDirection = "i-owe" | "owed-to-me";

  export type Installment = {
    dueDate: IsoDate;
    amountDue: Centavos;
    principalPortion?: Centavos;
    interestPortion?: Centavos;
  };

  export type Loan = {
    id: string;
    direction: LoanDirection;
    counterparty: string;
    principal: Centavos;
    /** Percent 0..100, informational only (domain §3.8). */
    interestRate: number | null;
    schedule: Installment[] | null;
    linkedWalletId: string | null;
    nextDueDate: IsoDate | null;
    nextDueAmount: Centavos | null;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  /** One matched payment (loan_payments table; a Transaction appears in at most one — I12). */
  export type LoanPayment = {
    id: string;
    loanId: string;
    transactionId: string;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Bill ----------
  export type BillAmountMode = "fixed" | "estimated";

  export type DueRule =
    | { kind: "day-of-month"; day: number } // months lacking the day use the last day
    | { kind: "semi-monthly" } // 15th and 30th (kinsenas/katapusan)
    | { kind: "every-n-weeks"; n: number; weekday: number } // weekday 0 = Sunday
    | { kind: "last-day-of-month" };

  export type BillAutoMatchRule = {
    merchantPattern: string;
    amountTolerancePct?: number;
    amountToleranceCentavos?: Centavos;
    dateWindowDays: number;
  };

  export type Bill = {
    id: string;
    name: string;
    amount: Centavos;
    amountMode: BillAmountMode;
    dueRule: DueRule;
    /** Day offsets relative to the due date; negative = before (e.g., [-3, 0]). */
    reminderOffsets: number[];
    autoMatchRule: BillAutoMatchRule | null;
    categoryId: string;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  /** One matched Bill cycle (bill_payments table; a Transaction matches at most one cycle — I12). */
  export type BillPayment = {
    id: string;
    billId: string;
    transactionId: string;
    cycleDueDate: IsoDate;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- RecurringPattern ----------
  export type RecurringPeriod = "weekly" | "monthly" | "annual";

  export type RecurringPattern = {
    id: string;
    merchant: string;
    amount: Centavos;
    period: RecurringPeriod;
    confidence: number;
    acknowledged: boolean;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- UserRule ----------
  export type UserRuleMatcher = {
    providerKey?: string;
    merchantPattern?: string;
    direction?: TxDirection;
    amountMin?: Centavos;
    amountMax?: Centavos;
  };

  export type UserRuleAction =
    | { kind: "set-category"; categoryId: string }
    | { kind: "set-wallet"; walletId: string }
    | { kind: "set-merchant"; merchant: string }
    | { kind: "mark-transfer" }
    | { kind: "suppress-recurring"; merchant: string }
    | { kind: "ignore" };

  export type UserRule = {
    id: string;
    matcher: UserRuleMatcher;
    action: UserRuleAction;
    priority: number;
    isEnabled: boolean;
    /** The originating correction (Review Queue item or Transaction id) — invariant I15. */
    createdFrom: string | null;
    appliedCount: number;
    lastAppliedAt: EpochMs | null;
    createdAt: EpochMs;
    updatedAt: EpochMs;
  };

  // ---------- Review Queue ----------
  export type ReviewKind =
    | "low-confidence"
    | "unknown-provider"
    | "ambiguous-transfer"
    | "possible-duplicate";

  /**
   * Parsed-candidate payload (amount, direction, merchant, wallet/category guesses…).
   * Stored opaquely by the foundation; the ingest plan (m1) owns and narrows the shape.
   */
  export type ReviewItemPayload = Record<string, unknown>;

  export type ReviewQueueItem = {
    id: string;
    kind: ReviewKind;
    payload: ReviewItemPayload;
    rawNotificationId: string | null;
    createdAt: EpochMs;
    expiresAt: EpochMs | null;
    resolvedAt: EpochMs | null;
  };

  export type NewReviewItem = {
    kind: ReviewKind;
    payload: ReviewItemPayload;
    rawNotificationId?: string | null;
    expiresAt?: EpochMs | null;
  };

  /**
   * How a review item was closed. On 'confirmed' the CALLER (m1) creates the
   * Transaction; the repo only marks the item resolved (queue items are never
   * Transactions themselves — invariant I13).
   */
  export type ReviewResolution = "confirmed" | "dismissed";

  // ---------- RawCapture (contract §4 shape; DB row adds expires_at) ----------
  export type RawCapture = {
    id: string;
    packageName: string;
    title: string | null;
    text: string | null;
    subText: string | null;
    bigText: string | null;
    postedAt: EpochMs;
    capturedAt: EpochMs;
  };
  ```
- [ ] Write the failing mapper test `lib/db/__tests__/mappers.test.ts`:
  ```ts
  import type { Category, ReviewQueueItem, Transaction, Wallet } from "@/types/domain";
  import {
    categoryToRow, reviewQueueItemToRow, rowToCategory, rowToReviewQueueItem,
    rowToTransaction, rowToWallet, transactionToRow, walletToRow,
  } from "../mappers";

  test("wallet row <-> domain round-trips with boolean/int conversion", () => {
    const wallet: Wallet = {
      id: "6f3c0f5e-8a3b-4d6e-9c1a-2b4d6e8f0a1c",
      name: "GCash",
      type: "e-wallet",
      balance: 250075,
      currency: "PHP",
      isArchived: true,
      createdAt: 1754060400000,
      updatedAt: 1754060400001,
    };
    const row = walletToRow(wallet);
    expect(row.is_archived).toBe(1);
    expect("wallet_id" in row).toBe(false); // sanity: no stray keys
    expect(rowToWallet(row)).toEqual(wallet);
  });

  test("transaction row <-> domain round-trips including nullables", () => {
    const tx: Transaction = {
      id: "0d9b1c2e-3f4a-45b6-8c7d-9e0f1a2b3c4d",
      walletId: "w1",
      categoryId: "c1",
      amount: 15000,
      direction: "out",
      occurredAt: 1754060400000,
      merchant: "Jollibee",
      counterparty: null,
      referenceNo: "REF123",
      source: "notification",
      confidence: 0.94,
      rawNotificationId: null,
      transferLinkId: null,
      note: null,
      createdAt: 1754060400002,
      updatedAt: 1754060400003,
    };
    const row = transactionToRow(tx);
    expect(row.wallet_id).toBe("w1");
    expect(row.reference_no).toBe("REF123");
    expect(row.counterparty).toBeNull();
    expect(rowToTransaction(row)).toEqual(tx);
  });

  test("category row <-> domain round-trips", () => {
    const category: Category = {
      id: "b2a4c6d8-1e2f-4a3b-9c8d-7e6f5a4b3c2d",
      name: "Food & Dining",
      parentId: null,
      icon: "utensils",
      isSystem: true,
      isHidden: false,
      createdAt: 1754060400000,
      updatedAt: 1754060400000,
    };
    expect(rowToCategory(categoryToRow(category))).toEqual(category);
  });

  test("review queue item round-trips its JSON payload", () => {
    const item: ReviewQueueItem = {
      id: "e1f2a3b4-c5d6-47e8-9f0a-1b2c3d4e5f6a",
      kind: "low-confidence",
      payload: { amount: 15000, direction: "out", merchant: "JUAN D" },
      rawNotificationId: "rn1",
      createdAt: 1754060400000,
      expiresAt: null,
      resolvedAt: null,
    };
    const row = reviewQueueItemToRow(item);
    expect(typeof row.payload_json).toBe("string");
    expect(rowToReviewQueueItem(row)).toEqual(item);
  });
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/mappers.test.ts` — expected FAILURE: `Cannot find module '../mappers'`.
- [ ] Create `lib/db/mappers.ts`:
  ```ts
  // lib/db/mappers.ts — row (snake_case) <-> domain (camelCase). The foundation
  // covers the aggregates its repos use; feature plans extend THIS file for theirs.
  import type {
    Category, ReviewItemPayload, ReviewKind, ReviewQueueItem, Transaction,
    TxDirection, TxSource, Wallet, WalletType,
  } from "@/types/domain";

  export type WalletRow = {
    id: string; name: string; type: string; balance: number; currency: string;
    is_archived: number; created_at: number; updated_at: number;
  };

  export function rowToWallet(row: WalletRow): Wallet {
    return {
      id: row.id,
      name: row.name,
      type: row.type as WalletType,
      balance: row.balance,
      currency: "PHP",
      isArchived: row.is_archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  export function walletToRow(wallet: Wallet): WalletRow {
    return {
      id: wallet.id,
      name: wallet.name,
      type: wallet.type,
      balance: wallet.balance,
      currency: wallet.currency,
      is_archived: wallet.isArchived ? 1 : 0,
      created_at: wallet.createdAt,
      updated_at: wallet.updatedAt,
    };
  }

  export type TransactionRow = {
    id: string; wallet_id: string; category_id: string; amount: number;
    direction: string; occurred_at: number; merchant: string | null;
    counterparty: string | null; reference_no: string | null; source: string;
    confidence: number; raw_notification_id: string | null;
    transfer_link_id: string | null; note: string | null;
    created_at: number; updated_at: number;
  };

  export function rowToTransaction(row: TransactionRow): Transaction {
    return {
      id: row.id,
      walletId: row.wallet_id,
      categoryId: row.category_id,
      amount: row.amount,
      direction: row.direction as TxDirection,
      occurredAt: row.occurred_at,
      merchant: row.merchant,
      counterparty: row.counterparty,
      referenceNo: row.reference_no,
      source: row.source as TxSource,
      confidence: row.confidence,
      rawNotificationId: row.raw_notification_id,
      transferLinkId: row.transfer_link_id,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  export function transactionToRow(tx: Transaction): TransactionRow {
    return {
      id: tx.id,
      wallet_id: tx.walletId,
      category_id: tx.categoryId,
      amount: tx.amount,
      direction: tx.direction,
      occurred_at: tx.occurredAt,
      merchant: tx.merchant,
      counterparty: tx.counterparty,
      reference_no: tx.referenceNo,
      source: tx.source,
      confidence: tx.confidence,
      raw_notification_id: tx.rawNotificationId,
      transfer_link_id: tx.transferLinkId,
      note: tx.note,
      created_at: tx.createdAt,
      updated_at: tx.updatedAt,
    };
  }

  export type CategoryRow = {
    id: string; name: string; parent_id: string | null; icon: string;
    is_system: number; is_hidden: number; created_at: number; updated_at: number;
  };

  export function rowToCategory(row: CategoryRow): Category {
    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      icon: row.icon,
      isSystem: row.is_system === 1,
      isHidden: row.is_hidden === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  export function categoryToRow(category: Category): CategoryRow {
    return {
      id: category.id,
      name: category.name,
      parent_id: category.parentId,
      icon: category.icon,
      is_system: category.isSystem ? 1 : 0,
      is_hidden: category.isHidden ? 1 : 0,
      created_at: category.createdAt,
      updated_at: category.updatedAt,
    };
  }

  export type ReviewQueueItemRow = {
    id: string; kind: string; payload_json: string;
    raw_notification_id: string | null; created_at: number;
    expires_at: number | null; resolved_at: number | null;
  };

  export function rowToReviewQueueItem(row: ReviewQueueItemRow): ReviewQueueItem {
    return {
      id: row.id,
      kind: row.kind as ReviewKind,
      payload: JSON.parse(row.payload_json) as ReviewItemPayload,
      rawNotificationId: row.raw_notification_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      resolvedAt: row.resolved_at,
    };
  }

  export function reviewQueueItemToRow(item: ReviewQueueItem): ReviewQueueItemRow {
    return {
      id: item.id,
      kind: item.kind,
      payload_json: JSON.stringify(item.payload),
      raw_notification_id: item.rawNotificationId,
      created_at: item.createdAt,
      expires_at: item.expiresAt,
      resolved_at: item.resolvedAt,
    };
  }
  ```
- [ ] Run `npx jest --ci lib/db/__tests__/mappers.test.ts` — expected PASS. Run `npx tsc --noEmit` — clean.
- [ ] Commit:
  ```
  git add types lib
  git commit -m "feat(mobile): add domain types, uuid helper, and row-domain mappers"
  ```
