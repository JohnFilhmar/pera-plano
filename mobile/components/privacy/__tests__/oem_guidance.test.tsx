// components/privacy/__tests__/oem_guidance.test.tsx — m3b Task 7 Step 2.
//
// `brand` is passed directly rather than mocking `react-native`'s `Platform`
// module — see oem_guidance.tsx's header for why that is the deliberate
// seam. `resolveOemGuidance` itself is also exercised directly: it is a pure
// function of a string, so the mapping is checked with no rendering at all
// first, and the component test on top of it proves the screen actually
// shows what that function returns.
import { render, screen } from "@testing-library/react-native";

import { OemGuidance, resolveOemGuidance } from "../oem_guidance";

describe("resolveOemGuidance — five brands plus the fallback", () => {
  test.each([
    ["Xiaomi", "Xiaomi, Redmi, or POCO", "MIUI / HyperOS"],
    ["Redmi", "Xiaomi, Redmi, or POCO", "MIUI / HyperOS"],
    ["POCO", "Xiaomi, Redmi, or POCO", "MIUI / HyperOS"],
    ["OPPO", "Oppo or Realme", "ColorOS"],
    ["realme", "Oppo or Realme", "ColorOS"],
    ["vivo", "Vivo or iQOO", "FuntouchOS / OriginOS"],
    ["iQOO", "Vivo or iQOO", "FuntouchOS / OriginOS"],
    ["HUAWEI", "Huawei or Honor", "EMUI"],
    ["HONOR", "Huawei or Honor", "EMUI"],
    ["samsung", "Samsung", "One UI"],
  ])("%s resolves to %s guidance", (brand, label, skin) => {
    const guidance = resolveOemGuidance(brand);
    expect(guidance.label).toBe(label);
    expect(guidance.skin).toBe(skin);
    expect(guidance.steps.length).toBeGreaterThan(0);
  });

  test("case and surrounding whitespace do not change the result", () => {
    expect(resolveOemGuidance("  xIAoMI  ")).toEqual(resolveOemGuidance("Xiaomi"));
  });

  test("an unrecognised brand degrades to the generic fallback rather than guessing", () => {
    const guidance = resolveOemGuidance("Some Brand Nobody Has Heard Of");
    expect(guidance.label).toBe("Your device");
    expect(guidance.steps.length).toBeGreaterThan(0);
  });

  test("null (no brand available) degrades to the same generic fallback", () => {
    expect(resolveOemGuidance(null)).toEqual(resolveOemGuidance("unknown-brand"));
  });

  test("a blank brand degrades to the generic fallback too", () => {
    expect(resolveOemGuidance("   ")).toEqual(resolveOemGuidance(null));
  });
});

describe("OemGuidance renders the matching steps per manufacturer", () => {
  test.each([
    ["Xiaomi", "Autostart"],
    ["OPPO", "Allow auto-launch"],
    ["vivo", "Autostart manager"],
    ["HUAWEI", "App launch"],
    ["samsung", "Unrestricted"],
  ])("%s shows a step naming its own settings screen", (brand, distinctiveText) => {
    render(<OemGuidance brand={brand} />);

    expect(screen.getByTestId("oem-guidance-steps").props).toBeTruthy();
    const guidance = resolveOemGuidance(brand);
    screen.getByText(`Battery settings for ${guidance.label}`);
    expect(
      screen.getAllByText(new RegExp(distinctiveText, "i")).length,
    ).toBeGreaterThan(0);
  });

  test("an unrecognised brand renders the generic fallback, not a wrong guess", () => {
    render(<OemGuidance brand="Totally Unknown Phone Co" />);

    screen.getByText("Battery settings for Your device");
    screen.getByText(/turn off battery optimization/i);
  });

  test("no brand at all (e.g. Platform.OS is not android under test) also renders the fallback", () => {
    render(<OemGuidance brand={null} />);

    screen.getByText("Battery settings for Your device");
  });
});
