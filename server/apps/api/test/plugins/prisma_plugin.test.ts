import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("prisma plugin", () => {
  it("decorates the app with a connected PrismaClient", async () => {
    const count = await app.prisma.user.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("disconnects cleanly on close", async () => {
    const scratch = buildApp();
    await scratch.ready();
    await expect(scratch.close()).resolves.toBeUndefined();
  });
});
