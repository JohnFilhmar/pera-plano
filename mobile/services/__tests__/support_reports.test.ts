// services/__tests__/support_reports.test.ts — what actually goes on the wire,
// and how each answer is classified.
//
// `jest.spyOn(apiClient, "post")` — never a real socket, matching
// `services/__tests__/telemetry.test.ts` and `api.test.ts`.
//
// THE FIELD-WHITELIST TEST IS THIS FEATURE'S PRIVACY GUARD, and it is the
// counterpart to telemetry.test.ts's. It does NOT say "send nothing about the
// user" — a problem report is user-authored content the user pressed Send on.
// It says the request carries the four things they typed or picked, the id
// that makes a retry idempotent, and nothing that was gathered behind their
// back. An addition here should make it FAIL, not pass silently.
import { apiClient } from "../api";
import { SUPPORT_REPORTS_PATH, sendSupportReport, supportReportParts } from "../support_reports";

import type { SupportReport } from "@/types/support";

const NOW = new Date(2026, 7, 28, 10, 0).getTime();

function fixture(overrides: Partial<SupportReport> = {}): SupportReport {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "Transfers show up twice",
    description: "Sent money from GCash to BPI and both legs landed as spending.",
    topic: "wrong_amount_or_wallet",
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    sentAt: null,
    ticketRef: null,
    attachments: [],
    ...overrides,
  };
}

/** The full AxiosResponse shape the client's own type demands, as telemetry.test.ts does. */
function response(status: number, data: unknown = {}) {
  return { data, status, statusText: "", headers: {}, config: {} as never };
}

let postSpy: jest.SpiedFunction<typeof apiClient.post>;

beforeEach(() => {
  postSpy = jest.spyOn(apiClient, "post");
});

afterEach(() => {
  postSpy.mockRestore();
});

test("a 2xx marks the report sent and carries the ticket reference back", async () => {
  postSpy.mockResolvedValue(response(201, { ticketId: "PP-1042" }));

  await expect(sendSupportReport(fixture())).resolves.toEqual({
    kind: "sent",
    ticketRef: "PP-1042",
  });
});

test("a 2xx with an unreadable body still counts as sent — never retried into a duplicate", async () => {
  postSpy.mockResolvedValue(response(202, "thanks"));

  await expect(sendSupportReport(fixture())).resolves.toEqual({ kind: "sent", ticketRef: null });
});

test("the request body carries exactly the user's own report, its id, and nothing else", () => {
  const fieldNames = supportReportParts(
    fixture({
      attachments: [
        {
          id: "att-1",
          reportId: "11111111-2222-3333-4444-555555555555",
          fileUri: "file:///docs/support_attachments/shot.png",
          mimeType: "image/png",
          byteSize: 4096,
          createdAt: NOW,
        },
      ],
    }),
  ).map(([name]) => name);

  expect(new Set(fieldNames)).toEqual(
    new Set(["reportId", "title", "description", "topic", "createdAt", "attemptCount", "attachments"]),
  );
});

test("the report is posted to the support route, as a body the client can serialize", async () => {
  postSpy.mockResolvedValue(response(202));

  await sendSupportReport(fixture());

  expect(postSpy).toHaveBeenCalledWith(SUPPORT_REPORTS_PATH, expect.anything(), expect.anything());
  expect(postSpy.mock.calls.at(-1)?.[1]).toBeInstanceOf(FormData);
});

test("the serialized body contains no device, install or ledger identifier", () => {
  const serialized = JSON.stringify(supportReportParts(fixture()));

  for (const forbidden of ["deviceId", "installId", "walletId", "transactionId", "Authorization"]) {
    expect(serialized).not.toContain(forbidden);
  }
});

test("the report id travels in the body — the idempotency key a retry depends on", () => {
  expect(supportReportParts(fixture())).toContainEqual([
    "reportId",
    "11111111-2222-3333-4444-555555555555",
  ]);
});

test("an attachment is sent as a file part with its own mime type", () => {
  const parts = supportReportParts(
    fixture({
      attachments: [
        {
          id: "att-1",
          reportId: "r",
          fileUri: "file:///docs/support_attachments/shot.png",
          mimeType: "image/png",
          byteSize: 4096,
          createdAt: NOW,
        },
      ],
    }),
  );

  expect(parts).toContainEqual([
    "attachments",
    { uri: "file:///docs/support_attachments/shot.png", name: "shot.png", type: "image/png" },
  ]);
});

test("no connection is a retry, never a rejection — the whole reason the outbox exists", async () => {
  postSpy.mockRejectedValue({ status: 0, message: "Network Error" });

  await expect(sendSupportReport(fixture())).resolves.toEqual({
    kind: "retry",
    reason: "No connection.",
  });
});

test("a 5xx is a retry — a broken server may not be broken in eight minutes", async () => {
  postSpy.mockResolvedValue(response(503));

  await expect(sendSupportReport(fixture())).resolves.toEqual({
    kind: "retry",
    reason: "Server error 503.",
  });
});

test("429 and 408 retry despite being 4xx — they mean 'later', not 'no'", async () => {
  postSpy.mockResolvedValue(response(429));
  await expect(sendSupportReport(fixture())).resolves.toMatchObject({ kind: "retry" });

  postSpy.mockResolvedValue(response(408));
  await expect(sendSupportReport(fixture())).resolves.toMatchObject({ kind: "retry" });
});

test("a 400 is a rejection — retrying the identical payload only repeats the answer", async () => {
  postSpy.mockResolvedValue(response(400, { error: "too long" }));

  await expect(sendSupportReport(fixture())).resolves.toEqual({
    kind: "rejected",
    reason: "The server could not accept this report (400).",
  });
});

// The reason string is rendered on the user's own screen, so it must never
// carry a response body through: a server is free to put anything in one.
test("a rejection reason never quotes the server's response body", async () => {
  postSpy.mockResolvedValue(
    response(413, { error: "user_id 91827 exceeded quota at https://internal.example/admin" }),
  );

  const outcome = await sendSupportReport(fixture());

  expect(outcome.kind).toBe("rejected");
  if (outcome.kind === "rejected") {
    expect(outcome.reason).not.toContain("91827");
    expect(outcome.reason).not.toContain("internal.example");
  }
});
