import type { FastifyInstance } from "fastify";

// Deliberately not `async`: neither the plugin nor the handler awaits anything, and the
// repo lints @typescript-eslint/require-await as an error. Returning the promise keeps the
// exported signature identical to an async function's.
export function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", () => ({ status: "ok" }));
  return Promise.resolve();
}
