import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { Card } from "../card";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("a default card is a shadow in light and a hairline in dark", () => {
  render(<Card testID="c"><Text>x</Text></Card>);
  const classes = classesOf("c");
  expect(classes).toContain("shadow-sm");
  expect(classes).toContain("dark:border");
  expect(classes).toContain("dark:border-line-dark");
});

test("a flat card has neither — a nested card must not read as depth", () => {
  render(<Card testID="c" variant="flat"><Text>x</Text></Card>);
  const classes = classesOf("c");
  expect(classes).not.toContain("shadow-sm");
  expect(classes).not.toContain("dark:border-line-dark");
});

test("radius and padding still match the design's card", () => {
  render(<Card testID="c"><Text>x</Text></Card>);
  expect(classesOf("c")).toContain("rounded-2xl");
  expect(classesOf("c")).toContain("p-4");
});
