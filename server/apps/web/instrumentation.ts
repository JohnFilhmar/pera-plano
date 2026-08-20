/**
 * Next runs this once when the server starts and NOT during `next build` — verified on
 * this repo, and it is the whole reason the production gate can live here. See spec §5.3.
 *
 * This file is deliberately almost empty. Next compiles instrumentation for BOTH the
 * Node.js and the Edge runtimes (proxy.ts runs on Edge), and Turbopack analyses whatever
 * it can statically reach: with the gate inline it warned on every build about
 * `process.exit` and `node:fs`, which are exactly the things a boot gate is made of. The
 * gate therefore lives in its own module behind a dynamic import that only the Node
 * runtime ever reaches.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { runBootGate } = await import("./instrumentation_node");
  runBootGate();
}
