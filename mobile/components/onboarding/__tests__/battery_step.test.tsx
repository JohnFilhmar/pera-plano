// components/onboarding/__tests__/battery_step.test.tsx — task-2-brief.md's
// named tests for the battery-exemption step, covering both the
// presentational components/onboarding/battery_explainer.tsx AND the routed
// screen app/(onboarding)/battery.tsx that mounts it alongside
// components/privacy/oem_guidance.tsx (M3b Task 7) and fires the system
// exemption intent.
//
// `Linking.sendIntent` is mocked via a Proxy over jest.requireActual, same
// reasoning components/onboarding/__tests__/recovery_phrase.test.tsx documents
// for mocking `Share` the same way — spreading `{...actual}` eagerly evaluates
// every lazy getter on the real react-native module, including native-only
// exports that crash outside a real app.
const mockSendIntent = jest.fn().mockResolvedValue(undefined);
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "Linking") return { ...actual.Linking, sendIntent: mockSendIntent };
      return Reflect.get(target, prop, receiver);
    },
  });
});

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { fireEvent, render, screen } from "@testing-library/react-native";
import { resolveOemGuidance } from "@/components/privacy/oem_guidance";
import { BatteryExplainer } from "../battery_explainer";
import BatteryScreen from "@/app/(onboarding)/battery";

beforeEach(() => {
  jest.clearAllMocks();
  mockSendIntent.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// BatteryExplainer — purely presentational.
// ---------------------------------------------------------------------------

describe("BatteryExplainer", () => {
  test("explains that Android can stop background apps and that an exemption keeps tracking alive", () => {
    render(<BatteryExplainer />);

    const tree = JSON.stringify(screen.toJSON()).toLowerCase();
    expect(tree).toMatch(/sleep|stop/);
    expect(tree).toMatch(/background/);
    expect(tree).toMatch(/exempt/);
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/battery.tsx — mounts OemGuidance and fires the intent.
// ---------------------------------------------------------------------------

describe("BatteryScreen", () => {
  test("renders OEM-specific guidance for a known manufacturer", () => {
    render(<BatteryScreen brand="Xiaomi" />);

    const guidance = resolveOemGuidance("Xiaomi");
    expect(screen.getByText(`Battery settings for ${guidance.label}`)).toBeTruthy();
    expect(screen.getByTestId("oem-guidance-steps")).toBeTruthy();
  });

  test("renders generic guidance for an unknown manufacturer", () => {
    render(<BatteryScreen brand="Some Brand Nobody Has Heard Of" />);

    expect(screen.getByText("Battery settings for Your device")).toBeTruthy();
    expect(screen.getByText(/app-lock or auto-start manager/i)).toBeTruthy();
  });

  test("no brand at all also renders the generic fallback", () => {
    render(<BatteryScreen brand={null} />);

    expect(screen.getByText("Battery settings for Your device")).toBeTruthy();
  });

  test("pressing the primary action fires the battery settings intent and advances to providers", () => {
    render(<BatteryScreen brand={null} />);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    expect(mockSendIntent).toHaveBeenCalledWith(
      "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
    );
    expect(mockPush).toHaveBeenCalledWith("/(onboarding)/providers");
  });

  test("skipping advances to providers without opening the intent", () => {
    render(<BatteryScreen brand={null} />);

    fireEvent.press(screen.getByTestId("onboarding-skip-link"));

    expect(mockSendIntent).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/(onboarding)/providers");
  });

  test("pressing back returns to the previous step", () => {
    render(<BatteryScreen brand={null} />);

    fireEvent.press(screen.getByTestId("onboarding-back-button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
