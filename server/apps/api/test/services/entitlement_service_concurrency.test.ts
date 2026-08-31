import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { claimPregrantIfAny } from "../../src/services/entitlement_service.js";

const app = buildApp();
const NOW = 1_756_000_000_000;

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb(app.prisma);
});

async function makeUser(email: string): Promise<string> {
  const id = randomUUID();
  await app.prisma.user.create({
    data: { id, destination: email, createdAt: BigInt(NOW) },
  });
  return id;
}

/**
 * A pregrant is permanent Plus, so "single use" has to be enforced by the
 * database rather than by reasoning about who can reach it. Two concurrent
 * callers both reading claimedAt === null before either writes is the same
 * time-of-check-to-time-of-use shape already fixed in verifyOtp and in refresh
 * rotation; this pins it for the third place it appears.
 */
describe("claimPregrantIfAny under concurrency", () => {
  it("lets exactly one of many simultaneous callers claim a pregrant", async () => {
    const email = "tester@example.com";
    const userId = await makeUser(email);
    await app.prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email,
        note: "adb tester, predates Play",
        createdAt: BigInt(NOW - 1000),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        claimPregrantIfAny(app.prisma, userId, email, NOW),
      ),
    );

    expect(results.filter((claimed) => claimed)).toHaveLength(1);
    expect(results.filter((claimed) => !claimed)).toHaveLength(7);
  });

  it("stamps the claim exactly once, so the audit trail is not overwritten", async () => {
    const email = "audit@example.com";
    const userId = await makeUser(email);
    await app.prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email,
        note: "tester",
        createdAt: BigInt(NOW - 1000),
      },
    });

    // Each caller stamps a distinct time, so the stored value identifies which
    // one actually won. Asserting a fixed timestamp here would be wrong: any
    // caller may win the race, and pinning caller zero made this test fail
    // roughly one run in three.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        claimPregrantIfAny(app.prisma, userId, email, NOW + index).then(
          (claimed) => ({ claimed, stampedAt: NOW + index }),
        ),
      ),
    );

    const winners = results.filter((result) => result.claimed);
    expect(winners).toHaveLength(1);

    const pregrant = await app.prisma.betaPregrant.findUniqueOrThrow({
      where: { email },
    });
    expect(pregrant.claimedByUserId).toBe(userId);
    // Exactly the winner's stamp survives. A later caller overwriting it is the
    // failure this pins: it would leave the audit trail naming the wrong claim.
    expect(pregrant.claimedAt).toBe(BigInt(winners[0]!.stampedAt));
    expect(await app.prisma.entitlement.count()).toBe(1);
  });
});
