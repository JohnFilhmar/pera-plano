import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { INITIAL_RULESET } from "../../prisma/seed_data.js";

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

async function insertRuleset(version: number): Promise<void> {
  await app.prisma.parserRuleset.create({
    data: {
      id: randomUUID(),
      version,
      rulesJson: { ...INITIAL_RULESET, version },
      createdAt: BigInt(Date.now()),
    },
  });
}

describe("GET /v1/parser_rules", () => {
  it("returns the latest ruleset with the full providers array", async () => {
    await insertRuleset(1);
    await insertRuleset(2);
    const res = await app.inject({ method: "GET", url: "/v1/parser_rules" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      version: number;
      providers: Array<{ providerKey: string; packageNames: string[] }>;
    }>();
    expect(body.version).toBe(2);
    expect(body.providers.map((p) => p.providerKey)).toEqual([
      "gcash",
      "maya",
      "bpi",
    ]);
  });

  it("short-circuits to empty providers when since_version equals current", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=3",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 3, providers: [] });
  });

  it("short-circuits when since_version is ahead of current", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=99",
    });
    expect(res.json()).toEqual({ version: 3, providers: [] });
  });

  it("returns the full ruleset when since_version is behind", async () => {
    await insertRuleset(3);
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=2",
    });
    const body = res.json<{ version: number; providers: unknown[] }>();
    expect(body.version).toBe(3);
    expect(body.providers.length).toBe(3);
  });

  it("rejects a non-integer since_version with 400 validation_error", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/parser_rules?since_version=abc",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
  });

  it("404s with the error envelope when no ruleset exists", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/parser_rules" });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "not_found",
    );
  });
});
