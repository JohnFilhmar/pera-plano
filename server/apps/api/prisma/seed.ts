import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { INITIAL_RULESET } from "./seed_data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.parserRuleset.upsert({
    where: { version: INITIAL_RULESET.version },
    update: { rulesJson: INITIAL_RULESET },
    create: {
      id: randomUUID(),
      version: INITIAL_RULESET.version,
      rulesJson: INITIAL_RULESET,
      createdAt: BigInt(Date.now()),
    },
  });
  console.log(`Seeded parser ruleset version ${INITIAL_RULESET.version}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
