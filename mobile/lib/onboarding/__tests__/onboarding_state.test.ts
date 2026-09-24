// lib/onboarding/__tests__/onboarding_state.test.ts — task-1-brief.md's own
// six named tests, the four that land in this file: ONBOARDING_STEPS is in
// the specified order, nextStep advances and returns null at the end,
// completeOnboarding sets the flag, isOnboardingComplete reads it.
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { freshDb } from "@/test_support/db";
import * as onboardingState from "../onboarding_state";
import {
  completeOnboarding,
  isOnboardingComplete,
  nextStep,
  ONBOARDING_STEPS,
  readOnboardingStep,
  recordOnboardingStep,
  stepFromPathname,
} from "../onboarding_state";

beforeEach(async () => {
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

test("ONBOARDING_STEPS is exactly the ten steps, in the documented order", () => {
  // "alerts" is the tenth, added by GAP-003: the POST_NOTIFICATIONS ask used
  // to be folded into "access" and was never actually made, so no alert of
  // any kind could be displayed on Android 13+.
  expect(ONBOARDING_STEPS).toEqual([
    "welcome",
    "how_it_works",
    "access",
    "battery",
    "providers",
    "wallets",
    "income",
    "first_limit",
    "alerts",
    "done",
  ]);
});

test("nextStep advances one step at a time through the whole list", () => {
  for (let i = 0; i < ONBOARDING_STEPS.length - 1; i++) {
    expect(nextStep(ONBOARDING_STEPS[i])).toBe(ONBOARDING_STEPS[i + 1]);
  }
});

test("nextStep returns null once the flow has actually finished", () => {
  expect(nextStep("done")).toBeNull();
});

test("skipping the last real step still lands on done, not null -- rule 1's dead-end guard", () => {
  // The exact transition a Skip tap on the last content step takes. A wrong
  // answer here strands the user on alerts with no way forward.
  expect(nextStep("alerts")).toBe("done");
  // And the step that used to hold that position still hands off to the new
  // one rather than jumping the ask entirely (GAP-003).
  expect(nextStep("first_limit")).toBe("alerts");
});

test("isOnboardingComplete reads false before anything writes it", async () => {
  expect(await isOnboardingComplete()).toBe(false);
});

test("completeOnboarding sets onboarding_complete, and isOnboardingComplete reflects it", async () => {
  await completeOnboarding();

  expect(await isOnboardingComplete()).toBe(true);
  expect(await getSetting("onboarding_complete")).toBe(true);
});

test("completeOnboarding is still the only writer of onboarding_complete", () => {
  // Pins the brief's "completeOnboarding is the only writer of
  // onboarding_complete" -- there is no other exported setter for THAT key to
  // call instead, so every caller goes through this one function.
  //
  // `recordOnboardingStep` is the module's second writer (GAP-067) and does not
  // weaken the rule: it writes `onboarding_step`, a cursor that means nothing
  // once the flag is true, and it cannot reach the flag at all. The list is
  // spelled out rather than filtered so that a third writer has to be added
  // here deliberately, which is the whole point of pinning the surface.
  expect(Object.keys(onboardingState).sort()).toEqual([
    "ONBOARDING_STEPS",
    "completeOnboarding",
    "isOnboardingComplete",
    "nextStep",
    "readOnboardingStep",
    "recordOnboardingStep",
    "stepFromPathname",
  ]);
});

// ---------------------------------------------------------------------------
// The resume cursor (GAP-067). Progress used to be deliberately unpersisted,
// which made an interrupted run start again at "welcome" -- and the two steps
// that send the user into system Settings are consecutive, so the five-minute
// background re-lock could throw the flow away twice in a row.
// ---------------------------------------------------------------------------

test("with nothing recorded, the flow resumes at the first step", async () => {
  expect(await readOnboardingStep()).toBe("welcome");
});

test("the recorded step is where the flow resumes", async () => {
  await recordOnboardingStep("battery");

  expect(await readOnboardingStep()).toBe("battery");
  expect(await getSetting("onboarding_step")).toBe("battery");
});

test("a later record replaces the earlier one rather than accumulating", async () => {
  await recordOnboardingStep("battery");
  await recordOnboardingStep("income");

  expect(await readOnboardingStep()).toBe("income");
});

test("a stored step this build does not know falls back to the first step", async () => {
  // What a downgrade, or a renamed step, actually leaves behind. Planted
  // through the table rather than through `recordOnboardingStep`, whose
  // argument type is the very thing being violated here.
  await recordOnboardingStep("battery");
  const db = await getDatabase();
  await db.runAsync("UPDATE app_settings SET value_json = ? WHERE key = ?", [
    JSON.stringify("a_step_from_another_version"),
    "onboarding_step",
  ]);

  // "welcome" is the pre-cursor behaviour, so the worst a bad row can do is
  // what every row used to do -- never a route that fails to resolve.
  expect(await readOnboardingStep()).toBe("welcome");
});

test("stepFromPathname recognises a step, and only a step", () => {
  // Expo Router drops the group from `usePathname()`; both spellings are
  // accepted because only the last segment is considered.
  expect(stepFromPathname("/wallets")).toBe("wallets");
  expect(stepFromPathname("/(onboarding)/wallets")).toBe("wallets");

  // The three pre-flow screens share the route group and are NOT steps: they
  // are re-derived from the key state, and recording one as a resume point
  // would send an already-keyed user back to a screen that must never re-run.
  expect(stepFromPathname("/recovery_phrase")).toBeNull();
  expect(stepFromPathname("/device_lock")).toBeNull();
  expect(stepFromPathname("/providers")).toBe("providers");

  expect(stepFromPathname("/")).toBeNull();
  expect(stepFromPathname("")).toBeNull();
});
