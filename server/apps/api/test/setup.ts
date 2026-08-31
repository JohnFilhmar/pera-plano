process.env.DATABASE_URL ??=
  "postgresql://peraplano:peraplano@localhost:5432/peraplano";
process.env.JWT_SECRET ??= "test_jwt_secret_do_not_use_in_prod";
process.env.LOG_LEVEL ??= "silent";
