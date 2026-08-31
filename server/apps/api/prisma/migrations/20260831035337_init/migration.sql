-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" BIGINT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "revoked_at" BIGINT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parser_rulesets" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules_json" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "parser_rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_parse_stats" (
    "id" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "ruleset_version" INTEGER NOT NULL,
    "provider_key" TEXT NOT NULL,
    "parsed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "period_start" BIGINT NOT NULL,
    "period_end" BIGINT NOT NULL,
    "received_at" BIGINT NOT NULL,

    CONSTRAINT "telemetry_parse_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_vaults" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "device_id" TEXT NOT NULL,
    "blob" TEXT NOT NULL,
    "stored_at" BIGINT NOT NULL,

    CONSTRAINT "backup_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_destination_key" ON "users"("destination");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "parser_rulesets_version_key" ON "parser_rulesets"("version");

-- CreateIndex
CREATE UNIQUE INDEX "backup_vaults_user_id_key" ON "backup_vaults"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_user_id_key" ON "entitlements"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_vaults" ADD CONSTRAINT "backup_vaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
