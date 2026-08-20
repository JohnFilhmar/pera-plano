/**
 * Next runs this once when the server starts and NOT during `next build` — verified on
 * this repo, and it is the whole reason the production gate can live here. See spec §5.3.
 *
 * Next compiles this file for BOTH the Node.js and the Edge runtimes, because proxy.ts
 * runs on Edge. `@peraplano/common` writes log lines through process.stdout, which the
 * Edge runtime does not have, so importing it at module scope fails the production build
 * outright. The import is therefore dynamic and behind the runtime check: the boot gate is
 * a Node-process concern and there is nothing for it to guard on an Edge invocation.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;

  const { assertProductionConfig, createLogger, parseEnvironment } = await import(
    "@peraplano/common"
  );

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
      // restarts it, `docker ps` calls it healthy-looking, and the operator has to read
      // logs to discover the site is serving nothing. Exiting non-zero is what makes this
      // a gate rather than a warning.
      log.error("compliance configuration incomplete", { missing: result.missing.join(",") });

      // writeSync, not console.error: on a pipe (which is what a container's stdout is)
      // an ordinary write can still be queued when process.exit tears the process down,
      // and the one message that explains the crash is the one that must not be lost.
      const { writeSync } = await import("node:fs");
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
