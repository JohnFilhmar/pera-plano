// lib/onboarding/__tests__/install_evidence.test.ts — the write-once install
// capture (google-account-linking plan Task 7). The second test is the one
// that matters: a reinstall re-reads PackageManager and gets a LATER
// firstInstallTime, so a capture that overwrote would quietly replace the
// beta-window evidence with a date outside it. There is no other copy.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { captureInstallEvidence, getStoredInstallEvidence } from "../install_evidence";

jest.mock("expo-application", () => ({
  getInstallationTimeAsync: jest.fn(),
  getInstallReferrerAsync: jest.fn(),
  nativeApplicationVersion: "0.1.0",
}));

const NOW = 1_756_000_000_000;
const INSTALLED_AT = 1_755_000_000_000;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(INSTALLED_AT));
  (Application.getInstallReferrerAsync as jest.Mock).mockResolvedValue("utm_source=google-play");
});

describe("captureInstallEvidence", () => {
  it("records the first install time and the referrer", async () => {
    const evidence = await captureInstallEvidence(NOW);
    expect(evidence).toEqual({
      firstInstallAt: INSTALLED_AT,
      installReferrer: "utm_source=google-play",
      capturedAt: NOW,
      appVersionAtInstall: "0.1.0",
    });
  });

  it("never overwrites evidence captured earlier", async () => {
    await captureInstallEvidence(NOW);
    (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(NOW));
    const second = await captureInstallEvidence(NOW + 1_000_000);
    expect(second.firstInstallAt).toBe(INSTALLED_AT);
    expect(second.capturedAt).toBe(NOW);
  });

  it("stores nulls rather than throwing when the native calls fail", async () => {
    (Application.getInstallationTimeAsync as jest.Mock).mockRejectedValue(new Error("unavailable"));
    (Application.getInstallReferrerAsync as jest.Mock).mockRejectedValue(new Error("unavailable"));
    const evidence = await captureInstallEvidence(NOW);
    expect(evidence.firstInstallAt).toBeNull();
    expect(evidence.installReferrer).toBeNull();
  });
});

describe("getStoredInstallEvidence", () => {
  it("returns null before anything is captured", async () => {
    expect(await getStoredInstallEvidence()).toBeNull();
  });

  it("returns what capture stored", async () => {
    await captureInstallEvidence(NOW);
    expect((await getStoredInstallEvidence())?.firstInstallAt).toBe(INSTALLED_AT);
  });
});
