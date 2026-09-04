// lib/onboarding/__tests__/onboarding_state.test.ts — task-1-brief.md's own
// six named tests, the four that land in this file: ONBOARDING_STEPS is in
// the specified order, nextStep advances and returns null at the end,
// completeOnboarding sets the flag, isOnboardingComplete reads it.
import { closeDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { freshDb } from "@/test_support/db";
import * as onboardingState from "../onboarding_state";
import {
  completeOnboarding,
  isOnboardingComplete,
  nextStep,
  ONBOARDING_STEPS,
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

test("completeOnboarding is the only writer this module exposes", () => {
  // Pins the brief's "completeOnboarding is the only writer of
  // onboarding_complete" -- there is no other exported setter here to call
  // instead, so every caller goes through this one function.
  expect(Object.keys(onboardingState).sort()).toEqual([
    "ONBOARDING_STEPS",
    "completeOnboarding",
    "isOnboardingComplete",
    "nextStep",
  ]);
});
