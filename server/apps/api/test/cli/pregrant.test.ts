import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../helpers/db.js";
import { addPregrant, listPregrants } from "../../src/cli/pregrant.js";

const prisma = new PrismaClient();
const NOW = 1_756_000_000_000;

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("addPregrant", () => {
  it("creates a pregrant and lowercases the email", async () => {
    expect(await addPregrant(prisma, "Tester@Example.com", "adb tester", NOW)).toEqual({ created: true });
    const rows = await listPregrants(prisma);
    expect(rows).toEqual([{ email: "tester@example.com", note: "adb tester", claimedAt: null }]);
  });

  it("is idempotent for an email already on the list", async () => {
    await addPregrant(prisma, "tester@example.com", "first", NOW);
    expect(await addPregrant(prisma, "tester@example.com", "second", NOW + 1000)).toEqual({ created: false });
    const rows = await listPregrants(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.note).toBe("first");
  });

  it("refuses an email that is not an address", async () => {
    await expect(addPregrant(prisma, "not-an-email", "x", NOW)).rejects.toThrow("email");
  });

  it("refuses an empty note, because an unexplained permanent grant is unauditable", async () => {
    await expect(addPregrant(prisma, "a@b.com", "  ", NOW)).rejects.toThrow("note");
  });
});
