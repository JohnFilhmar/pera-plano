// lib/onboarding/onboarding_state.ts — the M3c numbered onboarding flow's
// step order and completion flag (m3c-onboarding-client plan Task 1;
// docs/04-features/01-onboarding.md's canonical step order, steps 1-10 minus
// the finish screen's own sub-split).
//
// NOT THE WHOLE FLOW. The device lock and the recovery phrase
// (task-9a-brief.md, task-10-brief.md) run BEFORE any of these nine steps and
// are deliberately not among them: both are mandatory -- the only two
// unskippable onboarding screens in the app -- and rule 1 below is the
// opposite, "every step is skippable," so a type that included them would be
// lying about one entry the moment something iterated this list looking for
// a skip affordance. They stay exactly where the encryption and
// provider-selection plans put them: app/(onboarding)/index.tsx's own local
// sequencer, ahead of "welcome", unmodified by this task (see that file's own
// header comment for why routing on from there is intentionally left for the
// task that actually builds "welcome" -- wiring a Redirect at this step to a
// route that does not exist yet is the exact "ordering hazard" this codebase
// already avoided once in app/index.tsx's history).
//
// "providers" HERE IS NOT app/(onboarding)/providers.tsx. That file
// (provider-selection plan Task 4) already runs, once, immediately after the
// recovery phrase -- picking providers before any of these nine steps exist
// is what lets the listener start collecting data the user already has
// recovery words for. task-1-brief.md's interface fixes this union literally,
// "providers" included, so it is reproduced as written rather than trimmed to
// eight; how (or whether) a later task surfaces it a second time under this
// name is that task's call, not this one's.
//
// PROGRESS IS PERSISTED AFTER ALL (owner, 2026-09-18; GAP-067), reversing what
// this header used to say. The paragraph it replaces argued the flow was too
// short to be worth resuming. What that missed is that TWO CONSECUTIVE STEPS
// SEND THE USER OUT OF THE APP -- "access" and "battery" both hand off to
// system Settings -- and the background re-lock fires after five minutes away.
// On the way back `app/index.tsx` sees `onboarding_complete` still false and
// routes to this group, whose index redirected unconditionally to "welcome":
// the user lost every step they had done, and could lose it again on the very
// next screen. That is not a short flow, it is a loop.
//
// The three costs the old paragraph named are real, and each is answered here
// rather than waved away. The durable cursor is one `app_settings` row.
// "Abandoned" versus "mid-step" turns out not to be a distinction worth
// drawing: resuming at the recorded step is right for both, since every step is
// skippable and the two that write are idempotent (GAP-067's other half). And a
// value written by an app version that no longer matches this one is exactly
// what `readOnboardingStep` validates for -- anything outside
// `ONBOARDING_STEPS` reads as "welcome", so the worst a bad row can do is what
// every row used to do.
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";

/**
 * The M3c flow's own steps, in the order
 * docs/04-features/01-onboarding.md lays out.
 *
 * "alerts" IS THE TENTH, AND IT USED TO BE FOLDED INTO "access" (GAP-003).
 * The comment this replaces said docs' steps 3 and 4 -- Notification Access
 * and the Android 13+ POST_NOTIFICATIONS runtime permission -- were one
 * screen here, "a device below Android 13 has nothing to show for the second
 * half". What actually shipped was a screen that asks for the FIRST grant and
 * nothing at all for the second: `requestAlertPermission`
 * (lib/alerts/alerts_service.ts) had no caller anywhere in the app, and on
 * Android 13+ POST_NOTIFICATIONS defaults to denied until something asks. So
 * every notifier's `hasPermission()` check was false forever and no limit
 * alert, bill reminder, loan reminder, payday summary or tracking-interrupted
 * notice could be displayed at all.
 *
 * SEPARATE, AND LAST, rather than a second dialog on "access". Two system
 * dialogs behind one value screen is exactly the cold ask docs' own
 * "value screen first, system screen second" pairing forbids, and the
 * POST_NOTIFICATIONS dialog is one-shot per install -- it is worth spending
 * on a user who has just set a Limit and can be told what the alert will say,
 * not on one who is still three screens from having anything to be alerted
 * about.
 */
export type OnboardingStep =
  | "welcome"
  | "how_it_works"
  | "access"
  | "battery"
  | "providers"
  | "wallets"
  | "income"
  | "first_limit"
  | "alerts"
  | "done";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
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
];

/**
 * The step after `current`, or `null` once `current` is the last one
 * ("done"). Rule 1's "skipping never dead-ends" depends on this returning a
 * real step for every one of the other nine -- including "alerts", whose
 * successor is "done": that is the exact transition a Skip tap on the LAST
 * content step takes, and a wrong answer here strands the user on alerts with
 * no way forward.
 */
export function nextStep(current: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(current);
  return ONBOARDING_STEPS[index + 1] ?? null;
}

/**
 * The only writer of `onboarding_complete` (rule 4) -- every step screen this
 * flow builds funnels through this one function rather than calling
 * `setSetting` directly, so there is exactly one place that ever flips a
 * brand-new user into "/(tabs)".
 */
export async function completeOnboarding(): Promise<void> {
  await setSetting("onboarding_complete", true);
}

/** Reads the same flag `app/index.tsx` already routes on. */
export async function isOnboardingComplete(): Promise<boolean> {
  return getSetting("onboarding_complete");
}

/**
 * The step a route path belongs to, or `null` for a path outside the numbered
 * flow.
 *
 * MATCHED AGAINST `ONBOARDING_STEPS`, NOT PARSED OFF THE END. The three
 * pre-flow screens (device lock, recovery phrase, provider picker) share this
 * route group and are NOT steps -- see this file's header for why they are
 * deliberately absent from the union -- so a path has to be recognised rather
 * than merely read. Expo Router drops the `(onboarding)` group from
 * `usePathname()`, which is why only the last segment is considered.
 */
export function stepFromPathname(pathname: string): OnboardingStep | null {
  const last = pathname.split("/").filter(Boolean).pop();
  return ONBOARDING_STEPS.find((step) => step === last) ?? null;
}

/**
 * Records where the user is, so an interrupted run resumes there (GAP-067).
 *
 * One single-row write per step change, on the same `app_settings` table
 * `completeOnboarding` writes to.
 */
export async function recordOnboardingStep(step: OnboardingStep): Promise<void> {
  await setSetting("onboarding_step", step);
}

/**
 * Where to resume, or "welcome" when there is nothing usable to resume from.
 *
 * VALIDATED RATHER THAN TRUSTED, for the reason the header gives: the stored
 * value carries the type of whichever version wrote it, so a step this build
 * has renamed or dropped reads back as a string outside the union. Falling back
 * to the first step is the old, always-correct behaviour rather than a route
 * that would fail to resolve.
 */
export async function readOnboardingStep(): Promise<OnboardingStep> {
  const stored = await getSetting("onboarding_step");
  return ONBOARDING_STEPS.find((step) => step === stored) ?? "welcome";
}
