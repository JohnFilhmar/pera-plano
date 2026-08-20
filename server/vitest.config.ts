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
