// components/privacy/__tests__/captured_list.test.tsx — device-testing round 3,
// task 2. `CapturedList` is presentational (see the component's own header),
// so every fixture here is a plain `CapturedListItem` built by hand — no
// database, no native mock, the same split health_card.test.tsx uses for
// `HealthCard`.
//
// Package names and notification bodies below are ALL INVENTED
// (`com.example.*`, "You sent PHP …") — never the real bank/e-wallet
// notification text that reported this bug on the owner's device.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { CAPTURES_PER_PAGE, CapturedList, capturedPackageOptions } from "../captured_list";
import type { CapturedListItem, CapturedPackageOption } from "../captured_list";
import type { RawCapture } from "@/types/domain";

const NOW = Date.now();

function makeItem(
  id: string,
  packageName: string,
  providerName: string,
  overrides: Partial<RawCapture> = {},
): CapturedListItem {
  const capture: RawCapture = {
    id,
    packageName,
    title: providerName,
    text: "You sent PHP 100.00 to Juan",
    subText: null,
    bigText: null,
    postedAt: NOW,
    capturedAt: NOW,
    ...overrides,
  };
  return { capture, providerName, expiresAt: NOW + 1000, bodyDiscarded: false };
}

/** `count` items, all from the same synthetic package, ids `cap-0`..`cap-{count-1}`. */
function makeItems(count: number, packageName = "com.example.bank", providerName = "Example Bank"): CapturedListItem[] {
  return Array.from({ length: count }, (_, i) => makeItem(`cap-${i}`, packageName, providerName));
}

test("only the first page of captures is rendered", () => {
  const items = makeItems(25);
  render(<CapturedList items={items} />);

  const cards = screen.getAllByTestId(/^captured-item-cap-\d+$/);
  expect(cards).toHaveLength(CAPTURES_PER_PAGE);
  expect(screen.queryByTestId("captured-item-cap-10")).toBeNull();
});

test("the pager walks to the next page", () => {
  const items = makeItems(25);
  render(<CapturedList items={items} />);

  fireEvent.press(screen.getByTestId("captured-next-page"));

  expect(screen.getByTestId("captured-item-cap-10")).toBeTruthy();
  expect(screen.queryByTestId("captured-item-cap-0")).toBeNull();
  expect(screen.getByTestId("captured-pager-status")).toHaveTextContent("Showing 11–20 of 25");
});

test("filtering by package narrows the list to that app", () => {
  const items = [
    ...makeItems(3, "com.example.bank", "Example Bank"),
    ...[
      makeItem("wallet-0", "com.example.wallet", "Example Wallet"),
      makeItem("wallet-1", "com.example.wallet", "Example Wallet"),
    ],
  ];
  render(<CapturedList items={items} />);

  fireEvent.press(screen.getByTestId("captured-filter-com.example.wallet"));

  expect(screen.getByTestId("captured-item-wallet-0")).toBeTruthy();
  expect(screen.getByTestId("captured-item-wallet-1")).toBeTruthy();
  expect(screen.queryByTestId("captured-item-cap-0")).toBeNull();
  expect(screen.queryByTestId("captured-item-cap-1")).toBeNull();
  expect(screen.queryByTestId("captured-item-cap-2")).toBeNull();
});

test("changing the filter returns to the first page", () => {
  const items = [
    ...makeItems(15, "com.example.bank", "Example Bank"),
    makeItem("wallet-0", "com.example.wallet", "Example Wallet"),
  ];
  render(<CapturedList items={items} />);

  fireEvent.press(screen.getByTestId("captured-next-page"));
  expect(screen.getByTestId("captured-pager-status")).toHaveTextContent("Showing 11–16 of 16");

  fireEvent.press(screen.getByTestId("captured-filter-com.example.bank"));

  expect(screen.getByTestId("captured-pager-status")).toHaveTextContent(/^Showing 1–/);
});

test("capturedPackageOptions orders the noisiest app first", () => {
  // Insertion order deliberately does NOT match the expected sort order —
  // wallet (2) is added before bank (3), and card/wallet tie on count so the
  // label-ascending tiebreak is what has to put card ahead of wallet.
  const items = [
    ...makeItems(2, "com.example.wallet", "Example Wallet"),
    ...makeItems(3, "com.example.bank", "Example Bank"),
    ...makeItems(2, "com.example.card", "Example Card"),
  ];

  const options = capturedPackageOptions(items);

  const expected: CapturedPackageOption[] = [
    { packageName: "com.example.bank", label: "Example Bank", count: 3 },
    { packageName: "com.example.card", label: "Example Card", count: 2 },
    { packageName: "com.example.wallet", label: "Example Wallet", count: 2 },
  ];
  expect(options).toEqual(expected);
});

test("a row whose text was not kept says when it arrived and why it is empty", () => {
  // GAP-107: a non-money capture drained from the buffer keeps only its app
  // and its times. The card has to say so; an empty grey box reads as a bug.
  const postedAt = new Date(2026, 8, 21, 14, 5).getTime();
  const trimmed: CapturedListItem = {
    ...makeItem("trimmed", "com.example.chat", "Example Chat", {
      title: null,
      text: null,
      postedAt,
      capturedAt: postedAt,
    }),
    bodyDiscarded: true,
  };
  render(<CapturedList items={[trimmed]} />);

  const body = screen.getByTestId("captured-item-text-trimmed");
  expect(body).toHaveTextContent(/Arrived Sep 21, 2026 at 2:05 PM/);
  expect(body).toHaveTextContent(/kept only the app and the time/);
});
