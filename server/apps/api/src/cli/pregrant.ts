import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

export async function addPregrant(
  prisma: PrismaClient,
  email: string,
  note: string,
  nowMs: number,
): Promise<{ created: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`Not a valid email address: ${email}`);
  }
  const trimmedNote = note.trim();
  if (trimmedNote.length === 0) {
    throw new Error("A note is required: an unexplained permanent grant cannot be audited");
  }

  try {
    await prisma.betaPregrant.create({
      data: { id: randomUUID(), email: normalized, note: trimmedNote, createdAt: BigInt(nowMs) },
    });
    return { created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { created: false };
    }
    throw error;
  }
}

export async function listPregrants(
  prisma: PrismaClient,
): Promise<Array<{ email: string; note: string; claimedAt: number | null }>> {
  const rows = await prisma.betaPregrant.findMany({ orderBy: { email: "asc" } });
  return rows.map((row) => ({
    email: row.email,
    note: row.note,
    claimedAt: row.claimedAt === null ? null : Number(row.claimedAt),
  }));
}

/** `npm run pregrant -- add <email> "<note>"` or `npm run pregrant -- list` */
async function main(): Promise<void> {
  const [command, email, note] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    if (command === "add") {
      if (!email || !note) throw new Error('Usage: pregrant add <email> "<note>"');
      const { created } = await addPregrant(prisma, email, note, Date.now());
      console.log(created ? `added ${email}` : `${email} was already on the list`);
    } else if (command === "list") {
      for (const row of await listPregrants(prisma)) {
        console.log(`${row.claimedAt === null ? "unclaimed" : "claimed  "}  ${row.email}  ${row.note}`);
      }
    } else {
      throw new Error('Usage: pregrant add <email> "<note>" | pregrant list');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("pregrant.ts") || process.argv[1]?.endsWith("pregrant.js")) {
  await main();
}
