import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

/**
 * Flat config. `eslint-config-next` is still an eslintrc-shaped package on this version,
 * so the Next rules are wired through @next/eslint-plugin-next directly — its own
 * recommended + core-web-vitals rule sets, which is exactly what eslint-config-next
 * re-exports. Doing it this way keeps one config format instead of a compat shim.
 */
export default tseslint.config(
  {
    // .next is generated, node_modules is vendored, and next-env.d.ts is written by Next
    // on every build — linting any of them reports on code nobody here can edit.
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "**/*.tsbuildinfo",
      "**/tsconfig.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting, not just syntax. The rules that actually matter on this
        // codebase — no-floating-promises, no-unnecessary-condition-adjacent checks —
        // need the type graph, and turning them off would leave `lint` as decoration.
        // The five files below live outside both tsconfigs — they are build/test harness,
        // not shipped code — so the project service is told to lint them against its own
        // inferred default project rather than skipping them. Skipping is how a config
        // file quietly stops being checked. No "**" here: allowDefaultProject rejects it.
        // Classic `project` rather than `projectService`: tsconfig.harness.json is not
        // named tsconfig.json, so the service would never discover it and the vitest
        // configs and smoke setup would be linted without type information — which is
        // how a harness quietly stops being checked.
        // apps/api gets its own tsconfig.eslint.json rather than reusing its
        // tsconfig.json: the build config includes only src/ (rootDir src, emits to
        // dist), while lint has to cover test/ and vitest.config.ts too. Pointing the
        // parser at the build config would leave the api's tests unlinted, which is the
        // same quiet failure this comment block warns about above.
        project: [
          "./apps/web/tsconfig.json",
          "./libs/common/tsconfig.json",
          "./apps/api/tsconfig.eslint.json",
          "./tsconfig.harness.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Every ignored argument and variable in this repo is deliberate and named with a
      // leading underscore; anything else is a mistake worth failing on.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router only. The rule looks for a pages/ directory, does not find one, and
      // warns on every run about a routing style this project never used.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // eslint.config.mjs is the one file that cannot be inside a TypeScript project it is
    // itself configuring, so it gets syntax-only linting. Everything else — including the
    // vitest configs and the smoke harness — is type-checked through tsconfig.harness.json.
    files: ["eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
