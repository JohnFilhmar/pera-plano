/**
 * A discriminated union rather than a flat set of optional strings: with
 * `transport: "smtp"` the credentials are all present by construction, so no
 * caller has to check whether a host it was handed is really there.
 */
export type MailConfig =
  | { transport: "log" }
  | {
      transport: "smtp";
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      fromAddress: string;
      fromName: string;
    };

export type AppConfig = {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  telemetryRateLimitMax: number;
  authRateLimitMax: number;
  googleOauthClientId: string;
  playPackageName: string;
  playIntegrityServiceAccountJson: string;
  betaWindowStartAt: number;
  betaWindowEndAt: number;
  googleJwksUrl: string;
  integrityMaxSkewMs: number;
  googleAuthRateLimitMax: number;
  mail: MailConfig;
};

function loadMailConfig(env: NodeJS.ProcessEnv): MailConfig {
  const transport = env.MAIL_TRANSPORT ?? "log";
  if (transport !== "log" && transport !== "smtp") {
    throw new Error(`Invalid MAIL_TRANSPORT: ${transport}. Expected "log" or "smtp"`);
  }
  if (transport === "log") {
    // The log transport writes the OTP code to the server log, which is the
    // whole of authentication sitting in plaintext wherever logs are shipped.
    // Acceptable on a developer's machine, never in production.
    if (env.NODE_ENV === "production") {
      throw new Error(
        'Invalid MAIL_TRANSPORT: "log" writes OTP codes to the server log and is refused when NODE_ENV=production. Set MAIL_TRANSPORT=smtp',
      );
    }
    return { transport: "log" };
  }

  const requireMailVar = (key: string): string => {
    const value = env[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key} (MAIL_TRANSPORT=smtp)`);
    }
    return value;
  };

  const port = env.SMTP_PORT === undefined ? 587 : Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
  }

  return {
    transport: "smtp",
    host: requireMailVar("SMTP_HOST"),
    port,
    // Implicit TLS, which Gmail uses on 465. On 587 the connection starts
    // plaintext and upgrades through STARTTLS, so this stays false there.
    secure: env.SMTP_SECURE === "true",
    user: requireMailVar("SMTP_USER"),
    password: requireMailVar("SMTP_PASSWORD"),
    fromAddress: requireMailVar("MAIL_FROM_ADDRESS"),
    fromName: env.MAIL_FROM_NAME ?? "PeraPlano",
  };
}

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
  // Strict tier: the OTP request endpoint is unauthenticated and creates rows (and, once a
  // mail provider replaces the dev log, sends mail) on every call.
  const authRateLimitMax =
    env.AUTH_RATE_LIMIT_MAX === undefined ? 10 : Number(env.AUTH_RATE_LIMIT_MAX);
  if (!Number.isInteger(authRateLimitMax) || authRateLimitMax < 1) {
    throw new Error(`Invalid AUTH_RATE_LIMIT_MAX: ${env.AUTH_RATE_LIMIT_MAX}`);
  }

  const requireVar = (key: string): string => {
    const value = env[key];
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  };

  const requireEpochMs = (key: string): number => {
    const value = Number(requireVar(key));
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${key}: ${env[key]}`);
    }
    return value;
  };

  const googleOauthClientId = requireVar("GOOGLE_OAUTH_CLIENT_ID");
  const playPackageName = requireVar("PLAY_PACKAGE_NAME");
  const playIntegrityServiceAccountJson = requireVar(
    "PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON",
  );
  // The cohort window is the whole basis of a permanent Plus grant, so it is
  // configuration the operator has to state explicitly. There is no default that
  // could be right, and a silent one would hand out grants nobody decided on.
  const betaWindowStartAt = requireEpochMs("BETA_WINDOW_START_AT");
  const betaWindowEndAt = requireEpochMs("BETA_WINDOW_END_AT");
  if (betaWindowEndAt <= betaWindowStartAt) {
    throw new Error(
      `Invalid BETA_WINDOW_END_AT: ${env.BETA_WINDOW_END_AT} is not after BETA_WINDOW_START_AT`,
    );
  }
  const googleJwksUrl =
    env.GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs";
  const integrityMaxSkewMs =
    env.INTEGRITY_MAX_SKEW_MS === undefined
      ? 300_000
      : Number(env.INTEGRITY_MAX_SKEW_MS);
  if (!Number.isInteger(integrityMaxSkewMs) || integrityMaxSkewMs < 1) {
    throw new Error(
      `Invalid INTEGRITY_MAX_SKEW_MS: ${env.INTEGRITY_MAX_SKEW_MS}`,
    );
  }
  // Strictest tier of the three: both Google routes are unauthenticated at the
  // edge and every call costs two outbound requests to Google.
  const googleAuthRateLimitMax =
    env.GOOGLE_AUTH_RATE_LIMIT_MAX === undefined
      ? 20
      : Number(env.GOOGLE_AUTH_RATE_LIMIT_MAX);
  if (!Number.isInteger(googleAuthRateLimitMax) || googleAuthRateLimitMax < 1) {
    throw new Error(
      `Invalid GOOGLE_AUTH_RATE_LIMIT_MAX: ${env.GOOGLE_AUTH_RATE_LIMIT_MAX}`,
    );
  }

  return {
    databaseUrl,
    jwtSecret,
    port,
    telemetryRateLimitMax,
    authRateLimitMax,
    googleOauthClientId,
    playPackageName,
    playIntegrityServiceAccountJson,
    betaWindowStartAt,
    betaWindowEndAt,
    googleJwksUrl,
    integrityMaxSkewMs,
    googleAuthRateLimitMax,
    mail: loadMailConfig(env),
  };
}
