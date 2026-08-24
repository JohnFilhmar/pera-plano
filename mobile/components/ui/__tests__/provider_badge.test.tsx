import { render, screen } from "@testing-library/react-native";

import { ProviderBadge } from "../provider_badge";

test("a known provider renders its letter on its colour", () => {
  render(<ProviderBadge testID="b" providerKey="gcash" />);
  expect(screen.getByTestId("b-letter")).toHaveTextContent("G");
  const style = screen.getByTestId("b").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.backgroundColor).toBe("#0038A8");
});

test("an unknown provider still renders a badge", () => {
  render(<ProviderBadge testID="b" providerKey="chipmunk-bank" />);
  expect(screen.getByTestId("b-letter")).toHaveTextContent("C");
});

test("the badge is square at whatever size it is given", () => {
  render(<ProviderBadge testID="b" providerKey="maya" size={28} />);
  const style = screen.getByTestId("b").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.width).toBe(28);
  expect(flat.height).toBe(28);
});

test("the badge is labelled for assistive tech with the provider's real name", () => {
  render(<ProviderBadge testID="b" providerKey="gcash" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("GCash");
});
