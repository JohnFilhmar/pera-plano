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
