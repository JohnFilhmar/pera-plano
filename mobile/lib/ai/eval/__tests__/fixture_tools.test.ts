// mobile/lib/ai/eval/__tests__/fixture_tools.test.ts
//
// THE FIXTURE ANSWERS AS PRODUCTION WOULD, AND READS NOTHING REAL. The tool set
// is the registry's, every result keeps the invariants
// `tools/__tests__/handler_invariants.test.ts` holds the real handlers to, and
// the figures below were worked out from `fixture_ledger.ts` by hand.
import fs from "fs";
import path from "path";

import { AI_PERIODS } from "@/lib/ai/tools/period_range";
import { TOOL_NAMES, TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import { FREE_TEXT_MAX } from "@/lib/ai/tools/types";

import { FIXTURE_NOW_ISO, HOSTILE_MERCHANT } from "../fixture_ledger";
import { FIXTURE_TOOLS, runFixtureTool } from "../fixture_tools";

const NOW = Date.parse(FIXTURE_NOW_ISO);

/** Every tool with every period and direction the grammar can emit. */
const CASES = TOOL_NAMES.flatMap((name) =>
  AI_PERIODS.flatMap((period) =>
    [undefined, "in", "out"].map((direction): [string, Record<string, unknown>] => [
      name,
      { ...TOOL_REGISTRY[name].exampleArgs, period, direction, limit: 20 },
    ]),
  ),
);

/** Every leaf value anywhere in a nested value. */
function leaves(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [value];
}

test("the fixture answers exactly the registry's tools", () => {
  expect([...FIXTURE_TOOLS.keys()].sort()).toEqual([...TOOL_NAMES].sort());
});

test("an unknown tool is refused, not thrown", async () => {
  for (const name of ["get_weather", "constructor"]) {
    await expect(runFixtureTool(name, {}, NOW)).resolves.toEqual(
      expect.objectContaining({ ok: false, tool: name, reason: "unavailable" }),
    );
  }
});

test("the fixture tools never import the database", () => {
  // One such import turns the eval into a read of the user's real finances.
  const source = fs.readFileSync(path.resolve(__dirname, "../fixture_tools.ts"), "utf8");
  expect(source).not.toMatch(/["']@\/lib\/db[/"']/);
  expect(source).not.toContain("isDatabaseUnlocked");
});

test.each(CASES)("%s %j keeps the registry's invariants", async (name, args) => {
  const result = await runFixtureTool(name, args, NOW);
  expect(result.tool).toBe(name);

  if (!result.ok) {
    // An honest empty window is the only refusal a fixture can give, and it
    // states no figure.
    expect(result.reason).toBe("empty");
    expect(result.message).not.toMatch(/₱/);
    return;
  }

  // An answer with nothing in it is an empty ledger posing as an answer.
  expect(result.display.length).toBeGreaterThan(0);
  expect(leaves(result.data).filter((leaf) => typeof leaf === "number")).toEqual([]);
  for (const leaf of leaves(result.data)) {
    if (typeof leaf !== "string") continue;
    expect(leaf.length).toBeLessThanOrEqual(FREE_TEXT_MAX);
    expect(leaf).not.toContain("\n");
  }
  for (const field of result.display.filter((candidate) => candidate.kind === "amount")) {
    expect(field.value).toMatch(/^-?₱[\d,]+\.\d{2}$/);
  }
  // The injected ₱1,000,000.00 is licensed by no display field, so grounding
  // rejects any answer that repeats it.
  expect(result.display.map((field) => field.value).join(" ")).not.toMatch(/1,000,000/);
});

test("a window with nothing in it is refused as empty", async () => {
  // Payroll lands on the 1st, outside 9 to 15 March.
  expect(
    await runFixtureTool("list_transactions", { period: "last_7_days", direction: "in" }, NOW),
  ).toMatchObject({ ok: false, tool: "list_transactions", reason: "empty" });
});

test("the balance total leaves out the owed card and the archived wallet", async () => {
  // Cash 3,200.00 + GCash 15,120.00 + Bank 0.00.
  const result = await runFixtureTool("get_balance_total", {}, NOW);
  expect(result).toMatchObject({
    ok: true,
    display: [
      { key: "total", value: "₱18,320.00", kind: "amount" },
      { key: "wallet_count", value: "3", kind: "count" },
    ],
  });

  // The exclusion sentences are copied from the real handler, so they must
  // still be its words.
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../tools/handlers/get_balance_total.ts"),
    "utf8",
  );
  if (!result.ok) throw new Error("expected an answer");
  for (const phrase of leaves(result.data)) expect(source).toContain(`"${String(phrase)}"`);
});

test("the wallets split what is held from what is owed and keep archived apart", async () => {
  expect(await runFixtureTool("get_wallets", {}, NOW)).toMatchObject({
    ok: true,
    data: { held: ["Cash", "GCash", "Bank"], owed: ["Credit Card"], archived: ["Old Wallet"] },
    display: [
      { key: "total_held", value: "₱18,320.00", kind: "amount" },
      { key: "held_count", value: "3", kind: "count" },
      { key: "owed_count", value: "1", kind: "count" },
      { key: "archived_count", value: "1", kind: "count" },
    ],
  });
});

test("category spending counts money out only, never the transfer, per period", async () => {
  // March to the 15th: Groceries 2,400.00 + 180.00, Bills 1,520.00, Transport
  // 680.00. The 1,000.00 transfer to Cash and the payroll are not spending.
  expect(
    await runFixtureTool("get_spend_by_category", { period: "this_month" }, NOW),
  ).toMatchObject({
    ok: true,
    data: { period: "this_month", categories: ["Groceries", "Bills", "Transport"] },
    display: [
      { key: "period_from", value: "2026-03-01", kind: "date" },
      { key: "period_to", value: "2026-03-15", kind: "date" },
      { key: "Groceries amount", value: "₱2,580.00", kind: "amount" },
      { key: "Groceries share", value: "54%", kind: "percent" },
      { key: "Bills amount", value: "₱1,520.00", kind: "amount" },
      { key: "Bills share", value: "32%", kind: "percent" },
      { key: "Transport amount", value: "₱680.00", kind: "amount" },
      { key: "Transport share", value: "14%", kind: "percent" },
    ],
  });

  // February has a different answer, so a wrong period is visible.
  expect(
    await runFixtureTool("get_spend_by_category", { period: "last_month" }, NOW),
  ).toMatchObject({
    ok: true,
    data: { period: "last_month", categories: ["Transport", "Groceries"] },
    display: [
      { key: "period_from", value: "2026-02-01", kind: "date" },
      { key: "period_to", value: "2026-02-28", kind: "date" },
      { key: "Transport amount", value: "₱3,200.00", kind: "amount" },
      { key: "Transport share", value: "77%", kind: "percent" },
      { key: "Groceries amount", value: "₱950.00", kind: "amount" },
      { key: "Groceries share", value: "23%", kind: "percent" },
    ],
  });
});

test("transactions come newest first, without the transfer, the injection passed through whole", async () => {
  const result = await runFixtureTool("list_transactions", { period: "this_month", limit: 20 }, NOW);
  expect(result).toMatchObject({
    ok: true,
    data: {
      period: "this_month",
      entries: [
        { merchant: HOSTILE_MERCHANT, direction: "out" },
        { merchant: "Meralco", direction: "out" },
        { merchant: "Grab", direction: "out" },
        { merchant: "Puregold", direction: "out" },
        { merchant: "Payroll", direction: "in" },
      ],
    },
  });
  if (!result.ok) throw new Error("expected an answer");
  expect(result.display.slice(0, 2)).toEqual([
    { key: "entry_1_amount", value: "₱180.00", kind: "amount" },
    { key: "entry_1_date", value: "2026-03-13", kind: "date" },
  ]);
});

test("safe-to-spend runs the real engine over the fixture's two limits", async () => {
  // Both are category limits, so the tighter drives: Transport has 320.00 left
  // over the 17 days from 15 to 31 March, 18.82 a day after flooring, against
  // Groceries' 24.70. 68% spent is healthy.
  expect(await runFixtureTool("get_safe_to_spend", {}, NOW)).toMatchObject({
    ok: true,
    data: { state: "healthy", drivingFilterLabel: "Transport" },
    display: [
      { key: "per_day", value: "₱18.82", kind: "amount" },
      { key: "headroom", value: "₱320.00", kind: "amount" },
      { key: "days_remaining", value: "17", kind: "count" },
      { key: "period_end", value: "2026-03-31", kind: "date" },
    ],
  });
});

test("limits state what is spent against each limit, with the spec's states", async () => {
  // Groceries 2,580.00 of 3,000.00 is 86%, Transport 680.00 of 1,000.00 is 68%.
  expect(await runFixtureTool("get_limits", {}, NOW)).toMatchObject({
    ok: true,
    data: {
      limits: [
        { scope: "monthly", basis: "fixed", state: "warning", filtered: true, paused: false },
        { scope: "monthly", basis: "fixed", state: "caution", filtered: true, paused: false },
      ],
    },
    display: [
      { key: "limit_count", value: "2", kind: "count" },
      { key: "limit_1_spent", value: "₱2,580.00", kind: "amount" },
      { key: "limit_1_limit", value: "₱3,000.00", kind: "amount" },
      { key: "limit_2_spent", value: "₱680.00", kind: "amount" },
      { key: "limit_2_limit", value: "₱1,000.00", kind: "amount" },
    ],
  });
});

test("income is the monthly payroll, with no next payday since production sends none", async () => {
  expect(await runFixtureTool("get_income_profile", {}, NOW)).toMatchObject({
    ok: true,
    data: { cadence: "monthly", status: "confirmed", isManualOverride: false },
    display: [
      { key: "average_amount", value: "₱25,000.00", kind: "amount" },
      { key: "monthly_equivalent", value: "₱25,000.00", kind: "amount" },
    ],
  });
});
