// components/onboarding/__tests__/provider_picker.test.tsx — the onboarding
// provider picker (provider-selection plan Task 4), covering the presentational
// components/onboarding/provider_picker.tsx together with the route that owns
// the native writes, app/(onboarding)/providers.tsx. Same "screen + its
// components in one file" shape device_lock.test.tsx and recovery_phrase.test.tsx
// already established, and deliberately NOT under app/__tests__: files there
// sit in the Expo Router route table.
//
// ---------------------------------------------------------------------------
// THE RULE THAT CAN SILENTLY DISABLE THE ENTIRE PRODUCT (plan Task 4 rule 2).
//
// Selecting nothing means capture-EVERYTHING, not capture-nothing.
// `CapturePrefs.shouldCapture` returns true when the filter is empty — that is
// the allow-all default a fresh install depends on, and it is already pinned on
// the Kotlin side by CapturePrefsTest, so nothing here re-proves it.
//
// What CAN go wrong on this side is a picker that reads "the user chose no
// apps" as "the user wants no capture" and pauses the listener. The result
// installs, onboards cleanly, and then never records a single transaction: no
// error, no empty state, no log line, just a money tracker that tracks nothing.
//
// `shouldCapture` is Kotlin, so a JSX test cannot call it. The two JS-side
// discriminators are asserted together, everywhere it matters:
//
//   (a) setProviderFilter is called with []
//   (b) setCaptureEnabled(false) is NEVER called, on any path
//
// (a) alone passes against a screen that writes [] and then pauses capture —
// precisely the failure the rule exists to prevent — so every empty-selection
// test below asserts both.
// ---------------------------------------------------------------------------
jest.mock("@/modules/notification_listener", () => ({
  listObservedPackages: jest.fn(),
  getAppLabels: jest.fn(),
  setProviderFilter: jest.fn(),
  // Present in the mock and asserted-against but never imported by the screen.
  // A jest.fn() that is never called is the only way to prove an absence.
  setCaptureEnabled: jest.fn(),
}));

jest.mock("@/lib/db/repos/parser_rulesets_repo", () => ({
  getActiveRuleset: jest.fn(),
  upsertRuleset: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import {
  getAppLabels,
  listObservedPackages,
  setCaptureEnabled,
  setProviderFilter,
} from "@/modules/notification_listener";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { ProviderPicker } from "../provider_picker";
import ProvidersScreen from "@/app/(onboarding)/providers";
import seedJson from "@/assets/parser_rules/seed.json";

import type { ObservedPackage } from "@/modules/notification_listener";
import type { ProviderChoice } from "@/lib/ingest/provider_catalogue";
import type { RulesetBundle } from "@/lib/ingest/ruleset_types";

const mockListObservedPackages = listObservedPackages as jest.Mock;
const mockGetAppLabels = getAppLabels as jest.Mock;
const mockSetProviderFilter = setProviderFilter as jest.Mock;
const mockSetCaptureEnabled = setCaptureEnabled as jest.Mock;
const mockGetActiveRuleset = getActiveRuleset as jest.Mock;

const SEED: RulesetBundle = {
  ...(seedJson as unknown as Omit<RulesetBundle, "tunables">),
  tunables: DEFAULT_TUNABLES,
};

const GCASH = "com.globe.gcash.android";
const MAYA = "com.paymaya";
/** Observed on a device and absent from the seed — Task 3's whole purpose. */
const UNSEEDED_BANK = "com.example.realbank.ph";

const LAST_SEEN_AT = 1_754_100_000_000;

function observed(packageName: string): ObservedPackage {
  return { packageName, count: 4, lastSeenAt: LAST_SEEN_AT };
}

function choice(overrides: Partial<ProviderChoice> & { packageName: string }): ProviderChoice {
  return {
    providerKey: null,
    appLabel: null,
    displayName: overrides.packageName,
    seen: false,
    suggested: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListObservedPackages.mockResolvedValue([]);
  mockGetAppLabels.mockResolvedValue({});
  mockSetProviderFilter.mockResolvedValue(undefined);
  mockSetCaptureEnabled.mockResolvedValue(undefined);
  mockGetActiveRuleset.mockResolvedValue(SEED);
});

/** Renders the route and waits out its initial load. */
async function renderScreen(props: { onDone?: () => void } = {}) {
  render(<ProvidersScreen {...props} />);
  await screen.findByTestId("provider-picker");
}

// ---------------------------------------------------------------------------
// ProviderPicker — purely presentational.
// ---------------------------------------------------------------------------

describe("ProviderPicker", () => {
  test("renders the observed group before the suggested group", () => {
    render(
      <ProviderPicker
        choices={[
          choice({ packageName: GCASH, displayName: "gcash", seen: true, suggested: true }),
          choice({ packageName: MAYA, displayName: "maya" }),
        ]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    expect(screen.getAllByTestId(/^provider-group-/).map((g) => g.props.testID)).toEqual([
      "provider-group-observed",
      "provider-group-suggested",
    ]);
  });

  test("names the two groups exactly as the plan pins them", () => {
    render(
      <ProviderPicker
        choices={[
          choice({ packageName: GCASH, displayName: "gcash", seen: true, suggested: true }),
          choice({ packageName: MAYA, displayName: "maya" }),
        ]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    expect(screen.getByText("Apps we've seen")).toBeTruthy();
    expect(screen.getByText("Common in the Philippines")).toBeTruthy();
  });

  test("omits the observed group entirely when the device has seen nothing", () => {
    render(
      <ProviderPicker
        choices={[choice({ packageName: MAYA, displayName: "maya" })]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    // An empty "Apps we've seen" heading reads as a failure to detect anything;
    // docs/04-features/01-onboarding.md rule 7 is explicit that detecting
    // nothing is not an error.
    expect(screen.queryByTestId("provider-group-observed")).toBeNull();
    expect(screen.getByTestId("provider-group-suggested")).toBeTruthy();
  });

  test("a package that is both observed and suggested renders exactly ONE row, in the observed group", () => {
    render(
      <ProviderPicker
        choices={[
          choice({ packageName: GCASH, displayName: "gcash", seen: true, suggested: true }),
          choice({ packageName: MAYA, displayName: "maya" }),
        ]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    // The naive merge renders GCash twice — once because the device saw it,
    // once because it is in the seed — and the second tap then toggles a
    // different row than the one the user is looking at.
    expect(screen.getAllByTestId(`provider-choice-${GCASH}`)).toHaveLength(1);
    expect(
      within(screen.getByTestId("provider-group-observed")).getByTestId(
        `provider-choice-${GCASH}`,
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("provider-group-suggested")).queryByTestId(
        `provider-choice-${GCASH}`,
      ),
    ).toBeNull();
  });

  test("an observed package absent from the seed renders under its package name", () => {
    render(
      <ProviderPicker
        choices={[choice({ packageName: UNSEEDED_BANK, seen: true, suggested: false })]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    // Blank or filtered out would hide exactly the banks the seed got wrong.
    expect(screen.getByTestId(`provider-choice-${UNSEEDED_BANK}`)).toBeTruthy();
    expect(screen.getByText(UNSEEDED_BANK)).toBeTruthy();
  });

  test("states plainly that PeraPlano reads notifications only from the selected apps", () => {
    render(<ProviderPicker choices={[]} onConfirm={jest.fn()} onSkip={jest.fn()} />);

    // Rule 5 — the one moment the privacy promise becomes concrete, at the
    // exact moment the user is deciding.
    expect(screen.getByText(/reads notifications only from the apps you pick here/i)).toBeTruthy();
  });

  test("says out loud that picking nothing keeps every app in scope", () => {
    render(<ProviderPicker choices={[]} onConfirm={jest.fn()} onSkip={jest.fn()} />);

    // The honest half of rule 2: an empty filter is allow-all, so a screen
    // that only promised "only the apps you pick" would be lying to the user
    // who picks none.
    expect(screen.getByTestId("provider-picker-allow-all-note")).toBeTruthy();
  });

  test("is skippable, unlike the device-lock and recovery-phrase steps", () => {
    const onSkip = jest.fn();
    render(<ProviderPicker choices={[]} onConfirm={jest.fn()} onSkip={onSkip} />);

    fireEvent.press(screen.getByTestId("provider-picker-skip-button"));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  test("reports the tapped packages, and only those, on continue", () => {
    const onConfirm = jest.fn();
    render(
      <ProviderPicker
        choices={[
          choice({ packageName: GCASH, displayName: "gcash", seen: true, suggested: true }),
          choice({ packageName: MAYA, displayName: "maya" }),
        ]}
        onConfirm={onConfirm}
        onSkip={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    fireEvent.press(screen.getByTestId("provider-picker-continue-button"));

    expect(onConfirm).toHaveBeenCalledWith([GCASH]);
  });

  test("a second tap deselects rather than adding the package twice", () => {
    const onConfirm = jest.fn();
    render(
      <ProviderPicker
        choices={[choice({ packageName: GCASH, displayName: "gcash", seen: true })]}
        onConfirm={onConfirm}
        onSkip={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    fireEvent.press(screen.getByTestId("provider-picker-continue-button"));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  test("reports selection state through accessibilityState, not colour alone", () => {
    render(
      <ProviderPicker
        choices={[choice({ packageName: GCASH, displayName: "gcash", seen: true })]}
        onConfirm={jest.fn()}
        onSkip={jest.fn()}
      />,
    );

    const row = screen.getByTestId(`provider-choice-${GCASH}`);
    expect(row.props.accessibilityState).toEqual({ checked: false });

    fireEvent.press(row);

    expect(screen.getByTestId(`provider-choice-${GCASH}`).props.accessibilityState).toEqual({
      checked: true,
    });
  });

  test("continuing with nothing selected reports an empty list, never every rendered package", () => {
    const onConfirm = jest.fn();
    render(
      <ProviderPicker
        choices={[
          choice({ packageName: GCASH, displayName: "gcash", seen: true, suggested: true }),
          choice({ packageName: MAYA, displayName: "maya" }),
        ]}
        onConfirm={onConfirm}
        onSkip={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId("provider-picker-continue-button"));

    // [] is allow-all. Substituting "everything on screen" would look
    // identical today and silently drop every app the seed does not know
    // about the moment the catalogue changes.
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/providers.tsx — owns the native writes.
// ---------------------------------------------------------------------------

describe("ProvidersScreen", () => {
  test("offers the device's observed packages alongside the seed catalogue", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH), observed(UNSEEDED_BANK)]);

    await renderScreen();

    const observedGroup = within(screen.getByTestId("provider-group-observed"));
    expect(observedGroup.getByTestId(`provider-choice-${GCASH}`)).toBeTruthy();
    expect(observedGroup.getByTestId(`provider-choice-${UNSEEDED_BANK}`)).toBeTruthy();
    expect(
      within(screen.getByTestId("provider-group-suggested")).getByTestId(
        `provider-choice-${MAYA}`,
      ),
    ).toBeTruthy();
    // Observed AND seeded: one row, not two.
    expect(screen.getAllByTestId(`provider-choice-${GCASH}`)).toHaveLength(1);
  });

  test("an observed package the seed never heard of still renders, under its package name", async () => {
    mockListObservedPackages.mockResolvedValue([observed(UNSEEDED_BANK)]);

    await renderScreen();

    expect(screen.getByText(UNSEEDED_BANK)).toBeTruthy();
  });

  test("a selection writes through to setProviderFilter", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

    await renderScreen();
    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([GCASH]));
  });

  // -------------------------------------------------------------------------
  // Rule 2, both discriminators, on both empty paths.
  // -------------------------------------------------------------------------

  test("selecting none writes an empty filter AND leaves capture enabled", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([]));
    // The assertion that actually discriminates. Writing [] and then pausing
    // capture produces an app that tracks nothing, forever, silently.
    expect(mockSetCaptureEnabled).not.toHaveBeenCalledWith(false);
    expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
  });

  test("Skip writes an empty filter AND leaves capture enabled", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-skip-button"));
    });

    // Skip and "selected none" must be the SAME write. Wiring them to two
    // handlers is how one of them ends up safe and the other does not.
    await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([]));
    expect(mockSetCaptureEnabled).not.toHaveBeenCalledWith(false);
    expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
  });

  test("setCaptureEnabled is never called on ANY path through this screen", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH), observed(UNSEEDED_BANK)]);

    // Path 1: skip.
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-skip-button"));
    });
    screen.unmount();

    // Path 2: continue with nothing selected.
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });
    screen.unmount();

    // Path 3: continue with a selection.
    await renderScreen();
    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });
    screen.unmount();

    // Path 4: the write itself fails.
    mockSetProviderFilter.mockRejectedValueOnce(new Error("native bridge error"));
    await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
  });

  test("a failed filter write never strands the user in onboarding", async () => {
    mockSetProviderFilter.mockRejectedValueOnce(new Error("native bridge error"));
    const onDone = jest.fn();

    await renderScreen({ onDone });
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    // Allow-all is already the on-disk default, so a failed write leaves the
    // app capturing everything — degraded, but tracking. Blocking the step
    // would be the worse outcome.
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
  });

  test("reports completion once the filter is written", async () => {
    const onDone = jest.fn();
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

    await renderScreen({ onDone });
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  test("a double-tapped continue writes the filter exactly once", async () => {
    let resolveWrite!: () => void;
    mockSetProviderFilter.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

    await renderScreen();
    fireEvent.press(screen.getByTestId(`provider-choice-${GCASH}`));
    await act(async () => {
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
      fireEvent.press(screen.getByTestId("provider-picker-continue-button"));
    });

    expect(mockSetProviderFilter).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
  });

  // -------------------------------------------------------------------------
  // Loading the catalogue. Onboarding runs before the database is unlocked on
  // a fresh install, so neither source may be assumed available.
  // -------------------------------------------------------------------------

  test("falls back to the bundled seed catalogue when no ruleset is installed yet", async () => {
    mockGetActiveRuleset.mockResolvedValue(null);

    await renderScreen();

    expect(screen.getByTestId(`provider-choice-${GCASH}`)).toBeTruthy();
  });

  test("falls back to the bundled seed catalogue when the ruleset store cannot be read", async () => {
    // getDatabase() throws DatabaseLockedError until unlockDatabase(dek) has
    // run, and the first-run onboarding tree renders before that ever happens.
    mockGetActiveRuleset.mockRejectedValue(new Error("database is locked"));

    await renderScreen();

    expect(screen.getByTestId(`provider-choice-${GCASH}`)).toBeTruthy();
  });

  test("a failing listObservedPackages still shows the suggested catalogue", async () => {
    mockListObservedPackages.mockRejectedValue(new Error("native bridge error"));

    await renderScreen();

    expect(screen.queryByTestId("provider-group-observed")).toBeNull();
    expect(screen.getByTestId("provider-group-suggested")).toBeTruthy();
  });

  test("renders no picker at all until the catalogue has loaded", async () => {
    let resolveObserved!: (packages: ObservedPackage[]) => void;
    mockListObservedPackages.mockReturnValue(
      new Promise((resolve) => {
        resolveObserved = resolve;
      }),
    );

    render(<ProvidersScreen />);

    // Never a half-built list the user could tap through before the observed
    // packages arrive — the tap would write a filter missing their own apps.
    expect(screen.queryByTestId("provider-picker")).toBeNull();
    expect(screen.getByTestId("provider-picker-loading")).toBeTruthy();

    await act(async () => {
      resolveObserved([]);
    });
    await screen.findByTestId("provider-picker");
  });
});

// ---------------------------------------------------------------------------
// REAL APP NAMES (app-label plan).
//
// The seed's brand names are hand-written and go stale, because banks rebrand
// and package ids do not: `ph.seabank.seabank` still routes as "seabank" and
// the app on the phone is called Maribank. A tile reading "seabank" asks the
// user to recognise a company that no longer exists under that name — on the
// one screen whose entire job is that recognition.
// ---------------------------------------------------------------------------

describe("ProvidersScreen — real app names", () => {
  /** The motivating case: seeded under an old brand, renamed on the device. */
  const REBRANDED = "ph.seabank.seabank";

  test("a tile shows the name Android reports, not the seed's stale brand", async () => {
    mockGetActiveRuleset.mockResolvedValue({
      ...SEED,
      providers: [{ providerKey: "seabank", packageNames: [REBRANDED], rules: [] }],
    });
    mockListObservedPackages.mockResolvedValue([observed(REBRANDED)]);
    mockGetAppLabels.mockResolvedValue({ [REBRANDED]: "Maribank" });

    await renderScreen();

    expect(screen.getByTestId(`provider-name-${REBRANDED}`).props.children).toBe("Maribank");
    // The package line stays: it is the only thing that distinguishes two
    // tiles the device happens to label identically.
    expect(screen.getByTestId(`provider-package-${REBRANDED}`)).toBeTruthy();
  });

  test("the packages it asks about are the ones it is about to render", async () => {
    mockListObservedPackages.mockResolvedValue([observed(UNSEEDED_BANK)]);

    await renderScreen();

    const asked = mockGetAppLabels.mock.calls[0][0] as string[];
    // Including the unrecognised observed app — the case where a real name is
    // worth the most, since the fallback there is a raw package id.
    expect(asked).toContain(UNSEEDED_BANK);
    expect(asked).toContain(GCASH);
  });

  test("a label lookup that fails leaves a usable picker rather than an error", async () => {
    mockListObservedPackages.mockResolvedValue([observed(GCASH)]);
    mockGetAppLabels.mockRejectedValue(new Error("bridge is gone"));

    await renderScreen();

    // Degrades to the seeded brand name. Names are an improvement on the
    // fallback chain, never a prerequisite for onboarding.
    expect(screen.getByTestId(`provider-name-${GCASH}`).props.children).toBe("GCash");
  });

  test("an unlabelled catalogue app keeps its curated brand name", async () => {
    mockGetAppLabels.mockResolvedValue({});

    await renderScreen();

    // "Common in the Philippines" is BY DEFINITION apps this phone does not
    // have, so every one of them resolves to nothing.
    expect(screen.getByTestId(`provider-name-${GCASH}`).props.children).toBe("GCash");
  });

  test("selecting a renamed tile still writes its PACKAGE, never its label", async () => {
    mockGetActiveRuleset.mockResolvedValue({
      ...SEED,
      providers: [{ providerKey: "seabank", packageNames: [REBRANDED], rules: [] }],
    });
    mockListObservedPackages.mockResolvedValue([observed(REBRANDED)]);
    mockGetAppLabels.mockResolvedValue({ [REBRANDED]: "Maribank" });

    await renderScreen();
    fireEvent.press(screen.getByTestId(`provider-choice-${REBRANDED}`));
    fireEvent.press(screen.getByTestId("provider-picker-continue-button"));

    // The name is display only. The filter is keyed on the package id, which
    // is exactly what does NOT change when a bank rebrands.
    await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([REBRANDED]));
    expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
  });

  test("a bridge that answers with nothing at all still renders the picker", async () => {
  // REGRESSION. `getAppLabels` resolving nullish (a stubbed bridge, an older
  // native build without the function) used to make `applyAppLabels` throw
  // inside the load effect: no error surfaced, no tiles appeared, and
  // onboarding sat on "Looking for apps on your phone…" with no way forward.
  // A missing label is worth nothing; a wedged onboarding step costs the
  // whole install.
  mockGetAppLabels.mockResolvedValue(undefined);
  mockListObservedPackages.mockResolvedValue([observed(GCASH)]);

  await renderScreen();

  expect(screen.getByTestId(`provider-name-${GCASH}`).props.children).toBe("GCash");
});
});
