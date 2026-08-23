import { render, screen } from "@testing-library/react-native";

import { ProfileCard } from "../profile_card";

test("names the beta user and says what that means", () => {
  render(<ProfileCard testID="p" />);
  screen.getByText("Beta User");
  screen.getByText("Beta tester · everything unlocked");
});

test("there is no upgrade call to action during beta", () => {
  render(<ProfileCard testID="p" />);
  expect(screen.queryByText(/go plus/i)).toBeNull();
  expect(screen.queryByText(/upgrade/i)).toBeNull();
});

test("no install date is claimed, because none is recorded", () => {
  render(<ProfileCard testID="p" />);
  expect(screen.queryByText(/since/i)).toBeNull();
});
