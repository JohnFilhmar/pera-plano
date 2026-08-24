// app/(onboarding)/__tests__/how_it_works.test.tsx — task-3-brief.md,
// updated by mobile-ui-revamp Part 3 Task 6.
//
// Two named tests, both about what sits ABOVE how_it_works.tsx's existing
// mechanism/example/trust copy:
//   - the regression on rule 7: that copy (and its testIDs) must survive
//     untouched whatever renders above it. This is narrower than
//     setup_flow_e2e.test.tsx's own assertion on "how-it-works-mechanism"
//     (the controller's regression gate), but pins the OTHER two testIDs
//     that suite doesn't reach.
//   - the ordering test, written per the controller's Ruling 3: sibling
//     order is read off the rendered JSON tree (a depth-first walk
//     collecting `testID`s in render order), never off layout/coordinates.
//
// THE CAROUSEL ITSELF IS GONE FROM THIS SCREEN (Part 3 Task 6). The three
// numbered "how it works" cards the design calls for replaced it — see
// how_it_works.tsx's own header for why `ValueCarousel` is left intact but
// unmounted rather than deleted. The ordering test below now asserts the new
// "how-it-works-mechanism-cards" element leads the mechanism copy, in place
// of the retired "how-it-works-value-carousel" assertion.
//
// components/onboarding/__tests__/how_it_works_step.test.tsx already covers
// this screen's navigation and illustrative-notification wording; this file
// does not repeat that ground.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { render, screen } from "@testing-library/react-native";

import HowItWorksScreen from "@/app/(onboarding)/how_it_works";

type JsonNode = {
  props?: Record<string, unknown>;
  children?: JsonNode[] | JsonNode | string | null;
} | null;

/** Depth-first `testID` order, matching render order in the JSON tree --
 * the render-tree sibling-order check Ruling 3 requires. */
function collectTestIds(node: JsonNode | JsonNode[], out: string[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) collectTestIds(child, out);
    return;
  }
  if (typeof node === "string") return;
  const testID = node.props?.testID;
  if (typeof testID === "string") out.push(testID);
  if (node.children) collectTestIds(node.children as JsonNode | JsonNode[], out);
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("how_it_works still renders its mechanism, example and trust copy", () => {
  render(<HowItWorksScreen />);

  expect(screen.getByTestId("how-it-works-mechanism")).toBeTruthy();
  expect(screen.getByTestId("how-it-works-example")).toBeTruthy();
  expect(screen.getByTestId("how-it-works-trust")).toBeTruthy();
});

test("how_it_works renders the numbered mechanism cards above the mechanism copy", () => {
  render(<HowItWorksScreen />);

  const testIds: string[] = [];
  collectTestIds(screen.toJSON() as JsonNode, testIds);

  const cardsIndex = testIds.indexOf("how-it-works-mechanism-cards");
  const mechanismIndex = testIds.indexOf("how-it-works-mechanism");

  expect(cardsIndex).toBeGreaterThanOrEqual(0);
  expect(mechanismIndex).toBeGreaterThan(cardsIndex);
});

// Design F7 regression: the numbered badge's `bg-brand-soft` disc needs
// `brand-ink`, not the bare `brand` this file originally shipped with — the
// identical fragile 4.567:1 pairing (constants/colors.ts) already measured
// and replaced in components/gates/plus_gate.tsx. Anchored on the positive
// "the digit renders at all" lookup first, per the same rule the ordering
// test above already follows for its own testID lookups.
test("the step-number badges ink with brand-ink, not the bare brand tone their bg-brand-soft disc has no headroom against", () => {
  render(<HowItWorksScreen />);

  const first = screen.getByText("1");
  expect(String(first.props.className)).toContain("text-brand-ink");

  const second = screen.getByText("2");
  expect(String(second.props.className)).toContain("text-brand-ink");

  const third = screen.getByText("3");
  expect(String(third.props.className)).toContain("text-brand-ink");
});
