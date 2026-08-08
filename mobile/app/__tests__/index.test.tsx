// app/__tests__/index.test.tsx — the entry route's branch (task-10-brief.md),
// restored now that app/(onboarding)/index.tsx actually exists. Mocks
// app_settings_repo directly rather than a real database, since this file's
// only subject is "what href does Index compute for a given setting value" —
// not app_settings_repo's own persistence, which has its own suite.
jest.mock("@/lib/db/repos/app_settings_repo", () => ({
  getSetting: jest.fn(),
}));

let capturedHref: string | undefined;

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    capturedHref = props.href;
    return null;
  },
}));

import { render, waitFor } from "@testing-library/react-native";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import Index from "../index";

const mockGetSetting = getSetting as jest.Mock;

beforeEach(() => {
  capturedHref = undefined;
  jest.clearAllMocks();
});

test("a user with onboarding_complete false is sent to onboarding", async () => {
  mockGetSetting.mockResolvedValue(false);

  render(<Index />);

  await waitFor(() => expect(capturedHref).toBe("/(onboarding)"));
  expect(mockGetSetting).toHaveBeenCalledWith("onboarding_complete");
});

test("a user with onboarding_complete true is sent to the tabs", async () => {
  mockGetSetting.mockResolvedValue(true);

  render(<Index />);

  await waitFor(() => expect(capturedHref).toBe("/(tabs)"));
});

test("renders nothing while the setting is still being read", () => {
  mockGetSetting.mockReturnValue(new Promise(() => {}));

  render(<Index />);

  expect(capturedHref).toBeUndefined();
});

test("a failed read fails toward onboarding, never toward skipping it", async () => {
  mockGetSetting.mockRejectedValue(new Error("db unavailable"));

  render(<Index />);

  await waitFor(() => expect(capturedHref).toBe("/(onboarding)"));
});
