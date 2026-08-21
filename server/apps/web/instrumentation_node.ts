import { writeSync } from "node:fs";
import { assertProductionConfig, createLogger, parseEnvironment } from "@peraplano/common";

/**
 * The production boot gate. Lives in its own module, imported dynamically by
 * instrumentation.ts, because Next compiles instrumentation for the Edge runtime as well
 * as Node — proxy.ts runs on Edge — and Turbopack statically analyses whatever it can
 * reach. With this code inline behind a runtime check the build still succeeded but
 * warned about `process.exit` and `node:fs` on every run, and build noise on a compliance
 * site is how a real warning gets ignored. Nothing here runs on Edge; nothing here needs
 * to (see spec §5.3).
 */
export function runBootGate(): void {
  const result = parseEnvironment(process.env);
  const log = createLogger({ service: "peraplano-web", level: result.config.logLevel });

  if (result.config.nodeEnv === "production") {
    try {
      assertProductionConfig(result);
    } catch (error) {
      // Letting the throw escape does NOT stop the server. Verified on this build: Next
      // catches a rejected register(), prints "unhandledRejection", and carries on
      // listening — the port stays open and every request answers 500. A container that
      // is up and broken is worse than one that is down: `restart: unless-stopped` never
      // restarts it, and the operator has to read logs to discover the site serves
      // nothing. Exiting non-zero is what makes this a gate rather than a warning.
      log.error("compliance configuration incomplete", { missing: result.missing.join(",") });

      // writeSync, not console.error: on a pipe (which is what a container's stdout is)
      // an ordinary write can still be queued when process.exit tears the process down,
      // and the one message that explains the crash is the one that must not be lost.
      writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
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
