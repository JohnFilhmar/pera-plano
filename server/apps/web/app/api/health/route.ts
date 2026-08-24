import { buildHealthReport, getConfig, parseEnvironment } from "@peraplano/common";

export const dynamic = "force-dynamic";

const STARTED_AT = Date.now();

/**
 * Always HTTP 200, with the real state in `status`.
 *
 * The Dockerfile HEALTHCHECK polls this endpoint. Answering 503 while compliance values
 * are unset would make a half-configured DEV container flap unhealthy for a reason that
 * is not a liveness problem — the process is up and serving. Production cannot reach the
 * degraded state at all: instrumentation.ts aborts boot before the server listens.
 *
 * The body reports `configComplete` as a boolean and never a field list; the names go to
 * the boot log, not to an unauthenticated endpoint.
 */
export function GET(): Response {
  const report = buildHealthReport({
    service: "peraplano-web",
    // npm_package_version is set by `npm run`, and the container CMD is `node` directly,
    // so this reports "0.0.0" inside the image. That is a placeholder, not a bug to chase:
    // it becomes meaningful the day a release pipeline injects a version, and inventing one
    // here would report a build number nothing produced.
    version: process.env["npm_package_version"] ?? "0.0.0",
    startedAt: STARTED_AT,
    now: Date.now(),
    configComplete: parseEnvironment(process.env).missing.length === 0,
  });
  // Touches the memoised config so a malformed PUBLIC_BASE_URL surfaces here as a 500
  // rather than only on a page render.
  void getConfig();
  return Response.json(report, { status: 200 });
}
