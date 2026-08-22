import { render, screen } from "@testing-library/react-native";

import { ListRow } from "../list_row";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("a row keeps its 44dp minimum touch target", () => {
  render(<ListRow testID="r" title="Jollibee — Naga" onPress={() => {}} />);
  expect(classesOf("r")).toContain("min-h-[44px]");
});

test("title and subtitle use the design's row and secondary sizes", () => {
  render(<ListRow testID="r" title="Jollibee — Naga" subtitle="Food & drink · GCash" />);
  screen.getByText("Jollibee — Naga");
  screen.getByText("Food & drink · GCash");
});

test("a destructive row inks its title in danger, not its subtitle", () => {
  render(<ListRow testID="r" title="Wipe" subtitle="cannot be undone" destructive />);
  expect(String(screen.getByText("Wipe").props.className)).toContain("text-danger");
  expect(String(screen.getByText("cannot be undone").props.className)).not.toContain("text-danger");
});
