import { render } from "@testing-library/react-native";
import { Text } from "react-native";

test("jest-expo harness renders a react-native component", () => {
  const { getByText } = render(<Text>PeraPlano</Text>);
  expect(getByText("PeraPlano")).toBeTruthy();
});
