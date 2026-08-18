// components/ui/__tests__/image_placeholder.test.tsx — task-2-brief.md.
//
// The whole point of this primitive is that a reviewer can read the intended
// scene off the running app (rule 1), so the untruncated-brief tests here are
// load-bearing beyond this file: Task 3's onboarding carousel puts real
// marketing copy through this exact path, and a regression that lets the
// text get cut would ship a blank or half-sentence panel with nothing else
// catching it. The final test operationalises rule 5's overflow decision —
// documented in the component's header — as an assertion a reviewer can run,
// per the controller's amendment.
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ImagePlaceholder } from "../image_placeholder";

const LABEL = "The tap";
const BRIEF =
  "A phone screen mid-tap: a thumb pressing a GCash payment notification, " +
  "the confirm button accented in the app's brand green.";

test("renders the label and the full brief text", () => {
  render(<ImagePlaceholder label={LABEL} brief={BRIEF} />);

  expect(screen.getByText(LABEL)).toBeTruthy();
  expect(screen.getByText(BRIEF)).toBeTruthy();
});

test("renders the position badge when index and of are both given", () => {
  render(<ImagePlaceholder label={LABEL} brief={BRIEF} index={2} of={4} />);

  expect(screen.getByText("2 / 4")).toBeTruthy();
});

test("omits the position badge when only one of index or of is given", () => {
  render(<ImagePlaceholder label={LABEL} brief={BRIEF} index={2} />);
  expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull();
  screen.unmount();

  render(<ImagePlaceholder label={LABEL} brief={BRIEF} of={4} />);
  expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull();
});

test("applies the default 16:9 aspect ratio", () => {
  render(<ImagePlaceholder testID="placeholder" label={LABEL} brief={BRIEF} />);

  const flat = StyleSheet.flatten(screen.getByTestId("placeholder").props.style) as {
    aspectRatio?: number;
  };
  expect(flat.aspectRatio).toBe(16 / 9);
});

test("applies a custom aspect ratio", () => {
  render(
    <ImagePlaceholder testID="placeholder" label={LABEL} brief={BRIEF} aspectRatio={1} />,
  );

  const flat = StyleSheet.flatten(screen.getByTestId("placeholder").props.style) as {
    aspectRatio?: number;
  };
  expect(flat.aspectRatio).toBe(1);
});

test("keeps the full brief readable when it overflows the aspect box", () => {
  // Deliberately far taller, wrapped, than a 16:9 box could hold — this is
  // the case rule 5 exists for.
  const longBrief =
    "A very long art brief describing every element of the scene in exhaustive " +
    "detail: the exact shade of the wallpaper, the placement of every " +
    "character's hands, the weather outside the window, the make of the " +
    "phone on the table, the time on the wall clock, and several more " +
    "sentences of scene-setting that together run far taller than a 16:9 " +
    "panel could ever hold without wrapping across many lines of text.";

  render(
    <ImagePlaceholder testID="placeholder" label={LABEL} brief={longBrief} />,
  );

  // Rule 1: never truncated, however long. No numberOfLines, no ellipsis.
  const briefNode = screen.getByText(longBrief);
  expect(briefNode.props.numberOfLines).toBeUndefined();

  // Rule 5's chosen behaviour, restated as an assertion: the box is allowed
  // to grow past its ratio, so nothing here may fight that — no fixed height
  // pinned alongside aspectRatio, and no overflow-hidden clipping the text
  // off where the ratio would otherwise end.
  const flat = StyleSheet.flatten(screen.getByTestId("placeholder").props.style) as {
    height?: number;
    overflow?: string;
  };
  expect(flat.height).toBeUndefined();
  expect(flat.overflow).not.toBe("hidden");
});
