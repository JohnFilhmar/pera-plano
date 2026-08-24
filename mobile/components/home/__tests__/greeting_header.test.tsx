import { render, screen } from "@testing-library/react-native";

import { GreetingHeader } from "../greeting_header";

test("greets the beta user by their tag, not by a name", () => {
  render(<GreetingHeader testID="h" periodLabel="Kinsenas period · 8 days left" />);
  screen.getByText("Kumusta, Beta User");
});

test("shows the period line underneath", () => {
  render(<GreetingHeader testID="h" periodLabel="Kinsenas period · 8 days left" />);
  screen.getByText("Kinsenas period · 8 days left");
});

test("there is no notification bell — Home has no alerts route", () => {
  render(<GreetingHeader testID="h" periodLabel="Monthly period" />);
  expect(screen.queryByTestId("h-bell")).toBeNull();
});
