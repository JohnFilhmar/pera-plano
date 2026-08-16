// app/__tests__/more_tab.test.tsx — M3b Task 5: the More tab's remaining
// rows (Settings, Privacy centre, Listener health, Parser diagnostics, About
// and tier) and the Settings screen itself. Reports and Subscriptions — the
// two rows an earlier task already wired up — are covered by
// app/__tests__/more_hub.test.tsx; this file does not re-test them beyond
// what "every entry renders" needs.
//
// TWO SCREENS, ONE FILE, because the brief's six named tests split three and
// three across them (the More hub's entries/gates; the Settings screen's
// theme/telemetry behavior) and both screens are this one task's subject.
//
// m3b Task 8 flipped `privacy_center`, `listener_health` and
// `parser_diagnostics` (along with `reports` and `csv_export`) to "shipped"
// and wired their rows to the real routes those screens now live at
// (app/(tabs)/more/privacy.tsx, .../listener_health.tsx,
// .../parser_diagnostics.tsx). The rows' SoonGate wrapping stays in place
// (app/(tabs)/more/index.tsx's header comment records why), but with nothing
// soon left in the app it no longer blocks anything, so this file now
// asserts each row navigates for real rather than only "renders the Soon
// chip".
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import MoreScreen from "../(tabs)/more";
import SettingsScreen from "../(tabs)/more/settings";

const mockPush = jest.fn();

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  mockPush.mockClear();
  __setTierForTests(null);
  await AsyncStorage.clear();
  await freshDb();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The More hub
// ---------------------------------------------------------------------------

describe("the More hub", () => {
  test("renders every entry", () => {
    renderScreen(<MoreScreen />);

    screen.getByTestId("more-reports");
    screen.getByTestId("more-subscriptions");
    screen.getByTestId("more-settings");
    screen.getByTestId("more-privacy-center");
    screen.getByTestId("more-listener-health");
    screen.getByTestId("more-parser-diagnostics");
    screen.getByTestId("more-about");

    screen.getByText("Reports");
    screen.getByText("Subscriptions");
    screen.getByText("Settings");
    screen.getByText("Privacy centre");
    screen.getByText("Listener health");
    screen.getByText("Parser diagnostics");
    screen.getByText("About");
  });

  test("no entry renders a Soon chip — every FeatureKey ships as of m3b Task 8", () => {
    renderScreen(<MoreScreen />);

    expect(screen.queryAllByTestId("soon-chip")).toHaveLength(0);
  });

  test("Privacy centre navigates to /more/privacy", () => {
    renderScreen(<MoreScreen />);

    fireEvent.press(screen.getByTestId("more-privacy-center"));
    expect(mockPush).toHaveBeenCalledWith("/more/privacy");
  });

  test("Listener health navigates to /more/listener_health", () => {
    renderScreen(<MoreScreen />);

    fireEvent.press(screen.getByTestId("more-listener-health"));
    expect(mockPush).toHaveBeenCalledWith("/more/listener_health");
  });

  test("Parser diagnostics navigates to /more/parser_diagnostics", () => {
    renderScreen(<MoreScreen />);

    fireEvent.press(screen.getByTestId("more-parser-diagnostics"));
    expect(mockPush).toHaveBeenCalledWith("/more/parser_diagnostics");
  });

  test("the Plus-only entry renders the Plus badge on Free", () => {
    // Subscriptions is the one PlusGate row on this hub (docs/05-monetization.md).
    __setTierForTests("free");
    renderScreen(<MoreScreen />);

    expect(screen.getByTestId("plus-badge")).toBeTruthy();
  });

  test("Plus never sees the badge, on any row", () => {
    __setTierForTests("plus");
    renderScreen(<MoreScreen />);

    expect(screen.queryByTestId("plus-badge")).toBeNull();
  });

  test("Settings is a real, ungated screen — pressing it navigates to /more/settings", () => {
    renderScreen(<MoreScreen />);

    fireEvent.press(screen.getByTestId("more-settings"));
    expect(mockPush).toHaveBeenCalledWith("/more/settings");
  });

  test("About names the current tier", () => {
    __setTierForTests("free");
    renderScreen(<MoreScreen />);
    expect(within(screen.getByTestId("more-about")).getByText(/Free tier/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The Settings screen
// ---------------------------------------------------------------------------

describe("the Settings screen", () => {
  test("changing the theme persists and applies immediately", async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("theme-picker");

    fireEvent.press(screen.getByTestId("theme-picker-dark"));

    // APPLIES IMMEDIATELY: the picker reflects "dark" as selected right after
    // the press, in the same render pass — no waitFor needed for this half of
    // the claim, and none is used here on purpose.
    expect(screen.getByTestId("theme-picker-dark").props.accessibilityState.selected).toBe(
      true,
    );
    expect(screen.getByTestId("theme-picker-auto").props.accessibilityState.selected).toBe(
      false,
    );

    // PERSISTS: same AsyncStorage key contexts/theme_context.test.tsx already
    // pins — this test only proves the Settings screen's picker is wired to
    // the real `useTheme()`, not a second store.
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("peraplano.theme_preference")).toBe("dark"),
    );
  });

  test("the telemetry toggle persists", async () => {
    renderScreen(<SettingsScreen />);

    const toggle = await screen.findByTestId("settings-telemetry-toggle");
    expect(toggle.props.value).toBe(true); // telemetry_enabled defaults to true

    fireEvent(toggle, "valueChange", false);

    await waitFor(async () => expect(await getSetting("telemetry_enabled")).toBe(false));
    // The screen's own read reflects the write too, not only the repo directly.
    await waitFor(() =>
      expect(screen.getByTestId("settings-telemetry-toggle").props.value).toBe(false),
    );
  });

  test("the telemetry copy names exactly what is sent", async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("settings-telemetry-row");

    // Rule 3, verbatim promise: counts of successful/failed parses per
    // provider, and nothing else — no notification content, no amounts, no
    // merchants. If this text ever stops being true, the copy is what has to
    // change to match the implementation — never the other way around.
    screen.getByText(
      "When on, PeraPlano shares only counts of successful and failed notification parses, per provider. Never notification content, amounts, or merchant names.",
    );
  });

  test("the subscription-forget multiplier defaults to 1.5, clamps to the floor at 1, and persists", async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("settings-recurring-forget-row");

    const valueText = () =>
      screen.getByTestId("settings-forget-multiplier-value").props.children;

    expect(valueText()).toBe("1.5");
    screen.getByText("Forget a subscription after 1.5 missed payments");

    async function press(testID: string, expected: string): Promise<void> {
      fireEvent.press(screen.getByTestId(testID));
      await waitFor(() => expect(valueText()).toBe(expected));
    }

    await press("settings-forget-multiplier-increment", "1.75");
    expect(await getSetting("recurring_forget_multiplier")).toBe(1.75);

    // Step back down past the default and all the way to the floor (1),
    // never below it — the owner's stated range is [1, 3].
    await press("settings-forget-multiplier-decrement", "1.5");
    await press("settings-forget-multiplier-decrement", "1.25");
    await press("settings-forget-multiplier-decrement", "1");

    expect(await getSetting("recurring_forget_multiplier")).toBe(1);
    expect(
      screen.getByTestId("settings-forget-multiplier-decrement").props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  test("the subscription-forget multiplier clamps to the ceiling at 3 and disables further increment", async () => {
    // The symmetric counterpart of the floor test above. Only the floor (1)
    // and the decrement's disabled state were exercised before this test —
    // a regression in MULTIPLIER_MAX could silently let a user exceed the
    // owner's stated [1, 3] range with nothing to catch it.
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("settings-recurring-forget-row");

    const valueText = () =>
      screen.getByTestId("settings-forget-multiplier-value").props.children;

    async function press(testID: string, expected: string): Promise<void> {
      fireEvent.press(screen.getByTestId(testID));
      await waitFor(() => expect(valueText()).toBe(expected));
    }

    await press("settings-forget-multiplier-increment", "1.75");
    await press("settings-forget-multiplier-increment", "2");
    await press("settings-forget-multiplier-increment", "2.25");
    await press("settings-forget-multiplier-increment", "2.5");
    await press("settings-forget-multiplier-increment", "2.75");
    await press("settings-forget-multiplier-increment", "3");

    expect(await getSetting("recurring_forget_multiplier")).toBe(3);
    expect(
      screen.getByTestId("settings-forget-multiplier-increment").props.accessibilityState
        .disabled,
    ).toBe(true);

    // One more press past the ceiling must not move the value or the setting.
    fireEvent.press(screen.getByTestId("settings-forget-multiplier-increment"));
    expect(valueText()).toBe("3");
    expect(await getSetting("recurring_forget_multiplier")).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Quiet hours — docs/06-information-architecture.md §6.2 rule 7 says the
  // window is "user-adjustable", and a default nobody can change is not
  // adjustable. These rows are what makes that word true.
  // -------------------------------------------------------------------------

  test("quiet hours shows the spec's default window, on, 9:00 PM to 8:00 AM", async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("settings-quiet-hours-row");

    expect(screen.getByTestId("settings-quiet-hours-toggle").props.value).toBe(true);
    expect(screen.getByTestId("settings-quiet-start-value").props.children).toBe("9:00 PM");
    expect(screen.getByTestId("settings-quiet-end-value").props.children).toBe("8:00 AM");
  });

  test("the toggle persists, and hides the two bounds when the window is off", async () => {
    renderScreen(<SettingsScreen />);
    const toggle = await screen.findByTestId("settings-quiet-hours-toggle");

    fireEvent(toggle, "valueChange", false);

    await waitFor(async () => expect(await getSetting("quiet_hours_enabled")).toBe(false));
    // Two steppers that change nothing while the window is off are worse than
    // none — the setting they edit is not being consulted.
    await waitFor(() => expect(screen.queryByTestId("settings-quiet-hours-start-row")).toBeNull());
  });

  test("stepping the start time persists minutes from midnight, not a label", async () => {
    renderScreen(<SettingsScreen />);
    await screen.findByTestId("settings-quiet-start-value");

    fireEvent.press(screen.getByTestId("settings-quiet-start-increment"));

    await waitFor(async () => expect(await getSetting("quiet_hours_start_minute")).toBe(1290));
    await waitFor(() =>
      expect(screen.getByTestId("settings-quiet-start-value").props.children).toBe("9:30 PM"),
    );
  });

  test("the start time WRAPS past midnight rather than sticking at 11:30 PM", async () => {
    // The window itself wraps midnight — that is the whole subtlety of rule 7
    // — so a stepper that clamped at the end of the day would make an ordinary
    // late-start window unreachable from one direction.
    await setSetting("quiet_hours_start_minute", 1410); // 11:30 PM
    renderScreen(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("settings-quiet-start-value").props.children).toBe("11:30 PM"),
    );

    fireEvent.press(screen.getByTestId("settings-quiet-start-increment"));

    await waitFor(async () => expect(await getSetting("quiet_hours_start_minute")).toBe(0));
    await waitFor(() =>
      expect(screen.getByTestId("settings-quiet-start-value").props.children).toBe("12:00 AM"),
    );
  });

  test("stepping the end time backwards wraps the other way", async () => {
    await setSetting("quiet_hours_end_minute", 0); // midnight
    renderScreen(<SettingsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("settings-quiet-end-value").props.children).toBe("12:00 AM"),
    );

    fireEvent.press(screen.getByTestId("settings-quiet-end-decrement"));

    await waitFor(async () => expect(await getSetting("quiet_hours_end_minute")).toBe(1410));
  });
});
