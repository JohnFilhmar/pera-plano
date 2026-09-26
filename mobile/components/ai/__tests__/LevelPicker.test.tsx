// components/ai/__tests__/LevelPicker.test.tsx
//
// Assistant levels spec §6: five rows, 4 and 5 behind Plus and, the first time,
// behind a read-and-accept notice that changes nothing until it is accepted.
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { __setTierForTests } from "@/lib/entitlements";

import { LevelPicker, acceptNotice } from "../LevelPicker";

const MONTH = "April 2025";

function picker(overrides: Partial<ComponentProps<typeof LevelPicker>> = {}) {
  const onChoose = jest.fn();
  render(
    <LevelPicker
      visible
      level={2}
      accepted={false}
      knowledgeLimit={MONTH}
      maxLevel={5}
      onChoose={onChoose}
      onDismiss={() => {}}
      {...overrides}
    />,
  );
  return onChoose;
}

afterEach(() => {
  __setTierForTests(null);
});

test("an open level is chosen at once", () => {
  const onChoose = picker();
  fireEvent.press(screen.getByTestId("ai-level-3"));
  expect(onChoose).toHaveBeenCalledWith(3, false);
});

test("level 5 shows the notice first, and changes nothing until it is accepted", () => {
  const onChoose = picker();
  fireEvent.press(screen.getByTestId("ai-level-5"));

  expect(screen.getByText(acceptNotice(MONTH))).toBeTruthy();
  expect(onChoose).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  expect(onChoose).toHaveBeenCalledWith(5, true);
});

test("cancelling the notice changes nothing", () => {
  const onChoose = picker();
  fireEvent.press(screen.getByTestId("ai-level-4"));
  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

  expect(onChoose).not.toHaveBeenCalled();
  expect(screen.queryByTestId("confirm-dialog")).toBeNull();
});

test("once accepted, level 4 is chosen without the notice", () => {
  const onChoose = picker({ accepted: true });
  fireEvent.press(screen.getByTestId("ai-level-4"));
  expect(onChoose).toHaveBeenCalledWith(4, false);
});

test("level 5's description names the model's knowledge limit", () => {
  picker();
  expect(screen.getByTestId("ai-level-5")).toHaveTextContent(/knows nothing after April 2025/);
});

test("levels 4 and 5 carry the Plus badge", () => {
  picker();
  expect(screen.getAllByTestId("plus-badge")).toHaveLength(2);
});

test("on the free tier, level 4 opens the upgrade sheet instead", () => {
  __setTierForTests("free");
  const onChoose = picker();
  fireEvent.press(screen.getByTestId("ai-level-4"));

  expect(onChoose).not.toHaveBeenCalled();
  expect(screen.getByTestId("upgrade-row-assistant_levels")).toBeTruthy();
});

test("levels above the model's limit cannot be chosen, and say why", () => {
  const onChoose = picker({ maxLevel: 2 });
  fireEvent.press(screen.getByTestId("ai-level-3"));
  expect(onChoose).not.toHaveBeenCalled();
  expect(screen.getByTestId("ai-level-3")).toHaveTextContent(/Needs the larger Qwen3 1\.7B model\./);
});

test("on the free tier, a level the model cannot run says why instead of offering Plus", () => {
  __setTierForTests("free");
  const onChoose = picker({ maxLevel: 2 });
  fireEvent.press(screen.getByTestId("ai-level-4"));

  expect(onChoose).not.toHaveBeenCalled();
  expect(screen.queryByTestId("upgrade-row-assistant_levels")).toBeNull();
  expect(screen.getByTestId("ai-level-4")).toHaveTextContent(/Needs the larger Qwen3 1\.7B model\./);
});
