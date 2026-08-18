// app/(onboarding)/__tests__/how_it_works.test.tsx — task-3-brief.md.
//
// Two named tests, both about the ValueCarousel this task adds ABOVE
// how_it_works.tsx's existing content:
//   - the regression on rule 7: the mechanism/example/trust copy (and its
//     testIDs) must survive the carousel's addition untouched. This is
//     narrower than setup_flow_e2e.test.tsx's own assertion on
//     "how-it-works-mechanism" (the controller's regression gate), but
//     pins the OTHER two testIDs that suite doesn't reach.
//   - the ordering test, written per the controller's Ruling 3: sibling
//     order is read off the rendered JSON tree (a depth-first walk
//     collecting `testID`s in render order), never off layout/coordinates.
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

test("how_it_works renders the value carousel above the mechanism copy", () => {
  render(<HowItWorksScreen />);

  const testIds: string[] = [];
  collectTestIds(screen.toJSON() as JsonNode, testIds);

  const carouselIndex = testIds.indexOf("how-it-works-value-carousel");
  const mechanismIndex = testIds.indexOf("how-it-works-mechanism");

  expect(carouselIndex).toBeGreaterThanOrEqual(0);
  expect(mechanismIndex).toBeGreaterThan(carouselIndex);
});
