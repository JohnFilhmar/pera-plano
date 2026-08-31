process.env.DATABASE_URL ??=
  "postgresql://peraplano:peraplano@localhost:5432/peraplano";
process.env.JWT_SECRET ??= "test_jwt_secret_do_not_use_in_prod";
process.env.LOG_LEVEL ??= "silent";
// The production auth budget is 10/minute; suites that drive the auth routes make far more
// calls than that from one address. Rate-limit behaviour is tested with an explicit tiny
// override in test/routes/auth_rate_limit.test.ts, never with this default.
process.env.AUTH_RATE_LIMIT_MAX ??= "10000";
// Same reasoning for the Google budget: the production default is 20/minute and the route
// suite makes more calls than that from one address. test/routes/google_auth_rate_limit.test.ts
// overrides it explicitly.
process.env.GOOGLE_AUTH_RATE_LIMIT_MAX ??= "10000";
// Required by loadConfig. Every value here is fake on purpose: no test may reach Google, and
// the service-account JSON only has to parse, never to sign anything real.
process.env.GOOGLE_OAUTH_CLIENT_ID ??= "123.apps.googleusercontent.com";
process.env.PLAY_PACKAGE_NAME ??= "com.filldev.peraplano";
process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON ??=
  '{"client_email":"a@b","private_key":"pem"}';
process.env.BETA_WINDOW_START_AT ??= "1750000000000";
process.env.BETA_WINDOW_END_AT ??= "1760000000000";
