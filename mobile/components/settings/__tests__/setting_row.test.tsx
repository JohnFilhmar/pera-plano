// components/settings/__tests__/setting_row.test.tsx — M3b Task 5.
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { SettingRow } from "../setting_row";

test("renders the title, subtitle, and control slot", () => {
  render(
    <SettingRow
      testID="row"
      title="A setting"
      subtitle="What it does"
      control={<Text testID="row-control">Control</Text>}
    />,
  );

  screen.getByTestId("row");
  screen.getByText("A setting");
  screen.getByText("What it does");
  screen.getByTestId("row-control");
});

test("omits the subtitle line when none is given", () => {
  render(<SettingRow testID="row" title="A setting" control={<Text>Control</Text>} />);

  screen.getByText("A setting");
  expect(screen.queryByText("What it does")).toBeNull();
});
