process.env.DATABASE_URL ??=
  "postgresql://peraplano:peraplano@localhost:5432/peraplano";
process.env.JWT_SECRET ??= "test_jwt_secret_do_not_use_in_prod";
process.env.LOG_LEVEL ??= "silent";
// The production auth budget is 10/minute; suites that drive the auth routes make far more
// calls than that from one address. Rate-limit behaviour is tested with an explicit tiny
// override in test/routes/auth_rate_limit.test.ts, never with this default.
process.env.AUTH_RATE_LIMIT_MAX ??= "10000";
