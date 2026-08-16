// components/reports/__tests__/export_button.test.tsx — M3b Task 4, rule 6.
//
// `lib/reports/csv_export.ts`'s own mechanics (RFC 4180 quoting, CRLF, the
// BOM, transfer inclusion, the range conversion) are pinned by
// lib/reports/__tests__/csv_export.test.ts. This file only covers what
// belongs to the BUTTON: the tier gate and that a press calls through with
// the right arguments and reports the result — so `exportTransactionsCsv`
// is mocked rather than exercised for real (which would also pull in
// expo-file-system/expo-sharing, already covered by that other file).
jest.mock("@/lib/reports/csv_export", () => ({
  exportTransactionsCsv: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { __setTierForTests } from "@/lib/entitlements";
import { exportTransactionsCsv } from "@/lib/reports/csv_export";

import { ExportButton } from "../export_button";

const mockExport = exportTransactionsCsv as jest.MockedFunction<typeof exportTransactionsCsv>;

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const TODAY = "2026-08-31";
const FILE_URI = "file:///cache/peraplano-transactions-2026-08-31.csv";

afterEach(() => {
  __setTierForTests(null);
  jest.clearAllMocks();
});

test("free tier renders the button with the Plus badge and does not export on press", () => {
  __setTierForTests("free");
  const onExported = jest.fn();

  render(<ExportButton range={RANGE} today={TODAY} onExported={onExported} />);

  screen.getByTestId("plus-badge");
  fireEvent.press(screen.getByTestId("export-csv-button"));

  expect(mockExport).not.toHaveBeenCalled();
  expect(onExported).not.toHaveBeenCalled();
});

test("plus tier renders the button with no badge", () => {
  __setTierForTests("plus");

  render(<ExportButton range={RANGE} today={TODAY} />);

  expect(screen.queryByTestId("plus-badge")).toBeNull();
  screen.getByTestId("export-csv-button");
});

test("plus tier press calls exportTransactionsCsv with the given range and today, and reports the uri", async () => {
  __setTierForTests("plus");
  mockExport.mockResolvedValue(FILE_URI);
  const onExported = jest.fn();

  render(<ExportButton range={RANGE} today={TODAY} onExported={onExported} />);
  fireEvent.press(screen.getByTestId("export-csv-button"));

  await waitFor(() => expect(onExported).toHaveBeenCalledWith(FILE_URI));
  expect(mockExport).toHaveBeenCalledWith(RANGE, TODAY);
});

test("a failed export calls onError instead of throwing", async () => {
  __setTierForTests("plus");
  const error = new Error("disk full");
  mockExport.mockRejectedValue(error);
  const onError = jest.fn();

  render(<ExportButton range={RANGE} today={TODAY} onError={onError} />);
  fireEvent.press(screen.getByTestId("export-csv-button"));

  await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
});
