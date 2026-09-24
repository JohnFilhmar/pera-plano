import { render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { BottomSheet } from "@/components/ui/bottom_sheet";

// THE DEFECT THIS PINS. A loan with several possible payments grew the sheet
// upward until its first rows clipped off the top of the screen, and nothing
// scrolled them back: the body was a plain View, bottom-aligned, with no height
// bound at all. The owner reported it as "possible payments can't be scrolled".
test("a sheet's body is a bounded scroll area", () => {
  render(
    <BottomSheet visible onDismiss={() => {}} title="Is this a payment?">
      <Text>a candidate</Text>
    </BottomSheet>,
  );

  const body = screen.getByTestId("bottom-sheet-scroll");

  // A ScrollView with no height bound scrolls nothing, so the bound is the
  // assertion, not the presence of the component.
  const { maxHeight } = StyleSheet.flatten(body.props.style) as { maxHeight?: number };
  expect(typeof maxHeight).toBe("number");
  expect(maxHeight).toBeGreaterThan(0);
});

test("a sheet still renders its children", () => {
  render(
    <BottomSheet visible onDismiss={() => {}}>
      <Text>a candidate</Text>
    </BottomSheet>,
  );

  screen.getByText("a candidate");
});
