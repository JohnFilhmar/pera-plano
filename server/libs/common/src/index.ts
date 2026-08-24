// Extensionless, not the NodeNext-style ".js" specifier the rest of this package uses
// internally: this barrel is the one file in @peraplano/common that Next.js's Turbopack
// bundler resolves directly (via transpilePackages), and Turbopack only rewrites an
// explicit ".js" specifier to a sibling ".ts" file when tsconfig moduleResolution is
// "nodenext" — this workspace deliberately uses "bundler" (Next's own recommendation for
// the App Router), so a ".js" specifier here is a hard "Module not found" at build time.
export * from "./config/env";
export * from "./config/capabilities";
export * from "./content/site_facts";
export * from "./logging/logger";
export * from "./correlation/request_id";
export * from "./health/health";
