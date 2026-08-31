import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { createUserWithToken } from "../helpers/auth.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

const VAULT_BODY = {
  schemaVersion: 1,
  deviceId: "device-abc",
  blob: "ZW5jcnlwdGVkX2xlZGdlcl9ieXRlcw==",
};

describe("PUT /v1/backup/vault", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "unauthorized",
    );
  });

  it("stores the opaque blob and returns storedAt", async () => {
    const { userId, accessToken } = await createUserWithToken(app);
    const before = Date.now();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const { storedAt } = res.json<{ storedAt: number }>();
    expect(storedAt).toBeGreaterThanOrEqual(before);
    expect(storedAt).toBeLessThanOrEqual(Date.now());
    const row = await app.prisma.backupVault.findUnique({
      where: { userId },
    });
    expect(row?.blob).toBe(VAULT_BODY.blob);
    expect(row?.deviceId).toBe("device-abc");
  });

  it("keeps only the latest vault per user (upsert)", async () => {
    const { userId, accessToken } = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: {
        schemaVersion: 2,
        deviceId: "device-xyz",
        blob: "bmV3ZXJfYmxvYg==",
      },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const rows = await app.prisma.backupVault.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.blob).toBe("bmV3ZXJfYmxvYg==");
    expect(rows[0]?.schemaVersion).toBe(2);
    expect(rows[0]?.deviceId).toBe("device-xyz");
  });

  it("rejects an invalid body with 400 validation_error", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { schemaVersion: 0, deviceId: "", blob: "" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a non-base64 blob", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { ...VAULT_BODY, blob: "not base64 !!!" },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ignores a client-supplied userId instead of writing another user's vault", async () => {
    const alice = await createUserWithToken(app);
    const bob = await createUserWithToken(app);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: { ...VAULT_BODY, userId: alice.userId },
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.statusCode).toBe(400);
    const aliceRow = await app.prisma.backupVault.findUnique({
      where: { userId: alice.userId },
    });
    expect(aliceRow).toBeNull();
  });

  it("cannot overwrite another user's vault", async () => {
    const alice = await createUserWithToken(app);
    const bob = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: {
        schemaVersion: 9,
        deviceId: "bobs-phone",
        blob: "Ym9icy1ibG9i",
      },
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    const aliceRow = await app.prisma.backupVault.findUnique({
      where: { userId: alice.userId },
    });
    expect(aliceRow?.blob).toBe(VAULT_BODY.blob);
    expect(aliceRow?.deviceId).toBe("device-abc");
    const bobRow = await app.prisma.backupVault.findUnique({
      where: { userId: bob.userId },
    });
    expect(bobRow?.blob).toBe("Ym9icy1ibG9i");
  });
});

describe("GET /v1/backup/vault", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/backup/vault" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "unauthorized",
    );
  });

  it("404s with the error envelope when no vault has been stored", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "not_found",
    );
  });

  it("returns the stored vault round-trip", async () => {
    const { accessToken } = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      schemaVersion: number;
      deviceId: string;
      blob: string;
      storedAt: number;
    }>();
    expect(body.schemaVersion).toBe(1);
    expect(body.deviceId).toBe("device-abc");
    expect(body.blob).toBe(VAULT_BODY.blob);
    expect(typeof body.storedAt).toBe("number");
  });

  it("isolates vaults between users", async () => {
    const alice = await createUserWithToken(app);
    const bob = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/backup/vault",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("never lets a query parameter select another user's vault", async () => {
    const alice = await createUserWithToken(app);
    const bob = await createUserWithToken(app);
    await app.inject({
      method: "PUT",
      url: "/v1/backup/vault",
      payload: VAULT_BODY,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const res = await app.inject({
      method: "GET",
      url: `/v1/backup/vault?userId=${alice.userId}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(VAULT_BODY.blob);
  });
});
