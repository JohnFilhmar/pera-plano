-- CreateTable
CREATE TABLE "google_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL,
    "linked_at" BIGINT NOT NULL,
    "last_verified_at" BIGINT NOT NULL,

    CONSTRAINT "google_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "install_attestations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "google_sub" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "claim_source" TEXT NOT NULL,
    "install_begin_at" BIGINT,
    "first_install_at" BIGINT,
    "app_version_at_install" TEXT,
    "licensing_verdict" TEXT NOT NULL,
    "recognition_verdict" TEXT NOT NULL,
    "cohort_granted" BOOLEAN NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "install_attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beta_pregrants" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "claimed_at" BIGINT,
    "claimed_by_user_id" TEXT,

    CONSTRAINT "beta_pregrants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_identities_user_id_key" ON "google_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_identities_google_sub_key" ON "google_identities"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "beta_pregrants_email_key" ON "beta_pregrants"("email");

-- AddForeignKey
ALTER TABLE "google_identities" ADD CONSTRAINT "google_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_attestations" ADD CONSTRAINT "install_attestations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
