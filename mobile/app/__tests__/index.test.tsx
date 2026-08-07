// app/__tests__/index.test.tsx — the entry route's ordering hazard
// (task-17-brief.md, sharpened by coordinator ruling in task-17 review round
// 2): the (onboarding) route group does not exist yet — it ships in a later
// plan together with the branch that will redirect there, so there is never
// an intermediate state where the branch exists but the route doesn't.
// Today, index.tsx has no branch at all: it falls through to the tabs
// unconditionally. This proves that, and — via a mocked Redirect that
// captures its target rather than a real router — that it never even
// constructs the nonexistent route's href.
import { render } from "@testing-library/react-native";

let capturedHref: string | undefined;

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    capturedHref = props.href;
    return null;
  },
}));

import Index from "../index";

beforeEach(() => {
  capturedHref = undefined;
});

test("a first-run user still lands on the tabs, not the nonexistent onboarding route", () => {
  render(<Index />);
  expect(capturedHref).toBe("/(tabs)");
  expect(capturedHref).not.toBe("/(onboarding)");
});
