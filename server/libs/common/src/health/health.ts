export interface HealthReport {
  readonly status: "ok" | "degraded";
  readonly service: string;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly configComplete: boolean;
}

/**
 * configComplete is a boolean and never a field list. The names are not secret — they
 * are meant to be published — but a public endpoint enumerating what the operator has
 * not finished is free reconnaissance for no benefit. The names go to the log, at boot.
 */
export function buildHealthReport(input: {
  service: string;
  version: string;
  startedAt: number;
  now: number;
  configComplete: boolean;
}): HealthReport {
  return {
    status: input.configComplete ? "ok" : "degraded",
    service: input.service,
    version: input.version,
    uptimeSeconds: Math.floor((input.now - input.startedAt) / 1000),
    configComplete: input.configComplete,
  };
}
