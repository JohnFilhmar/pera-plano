export type AppConfig = {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  telemetryRateLimitMax: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const telemetryRateLimitMax =
    env.TELEMETRY_RATE_LIMIT_MAX === undefined
      ? 60
      : Number(env.TELEMETRY_RATE_LIMIT_MAX);
  if (!Number.isInteger(telemetryRateLimitMax) || telemetryRateLimitMax < 1) {
    throw new Error(
      `Invalid TELEMETRY_RATE_LIMIT_MAX: ${env.TELEMETRY_RATE_LIMIT_MAX}`,
    );
  }
  return { databaseUrl, jwtSecret, port, telemetryRateLimitMax };
}
