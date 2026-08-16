// components/ui/__tests__/empty_states.test.tsx — m3c Task 8.
//
// This file tests the CATALOGUE's own two invariants (IA §5): every listed
// screen has real, useful copy, and no two screens read the same. It does not
// re-test the eight already-shipped screens' own rendering — those are
// covered by their own screen tests (app/__tests__/*, and the individual
// list-screen suites) and this task's brief is explicit that re-testing
// working code is not the point. What IS new here is `home`, the one entry
// this audit found missing, and `getEmptyStateCopy`'s lookup contract.
import { EMPTY_STATE_CATALOGUE, getEmptyStateCopy } from "../empty_states";

// The IA §5 table's own nine rows, independent of catalogue array order —
// this fails if a row is ever silently dropped, not just if one is empty.
const REQUIRED_SCREENS = [
  "home",
  "transactions",
  "reviewQueue",
  "wallets",
  "planLimits",
  "planGoals",
  "planLoans",
  "planBills",
  "moreReports",
] as const;

test("every IA §5 screen has a catalogue entry", () => {
  for (const screen of REQUIRED_SCREENS) {
    expect(() => getEmptyStateCopy(screen)).not.toThrow();
  }
});

test("every catalogued screen has non-empty title and body", () => {
  for (const entry of EMPTY_STATE_CATALOGUE) {
    expect(entry.title.trim().length).toBeGreaterThan(0);
    expect(entry.body.trim().length).toBeGreaterThan(0);
  }
});

test("no catalogued copy is the generic placeholder this rule exists to ban", () => {
  // IA §5 rule: "never a blank screen and never a generic 'No data'." A future
  // entry that reaches for the lazy default should fail loudly here.
  const banned = /^no data$/i;
  for (const entry of EMPTY_STATE_CATALOGUE) {
    expect(entry.title).not.toMatch(banned);
    expect(entry.body).not.toMatch(banned);
  }
});

test("no two empty states share copy", () => {
  // IA §5's own standard for "thought about": a screen whose title OR body
  // matches another screen's has not been written for its own list.
  const titles = EMPTY_STATE_CATALOGUE.map((entry) => entry.title);
  const bodies = EMPTY_STATE_CATALOGUE.map((entry) => entry.body);

  expect(new Set(titles).size).toBe(titles.length);
  expect(new Set(bodies).size).toBe(bodies.length);
});

test("getEmptyStateCopy throws on an unknown screen rather than returning nothing", () => {
  // A silent `undefined` would let a caller render a blank title and body
  // with no test catching it before a device does.
  expect(() => getEmptyStateCopy("not-a-real-screen")).toThrow(
    /no catalogue entry for screen "not-a-real-screen"/,
  );
});

test("the home entry — the one gap this audit found — offers a way forward", () => {
  const home = getEmptyStateCopy("home");
  expect(home.title).toBe("Watching for your first transaction");
  expect(home.actionLabel).toBeDefined();
});
