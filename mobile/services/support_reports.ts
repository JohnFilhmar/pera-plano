// services/support_reports.ts — the wire half of offline problem reporting:
// one multipart POST that hands a queued report to the developer's ticketing
// system.
//
// THE SERVER STILL DOES NOT EXIST. `services/api.ts`'s header says it plainly,
// and it is as true of this route as of the other two: `POST
// /v1/support/reports` is a shape agreed here and implemented later, and
// `api.peraplano.filhmar.online` is the host it is agreed against. Every call
// this file makes today fails the same way a call from a phone in a tunnel
// fails, which is exactly the condition the outbox behind it was built for —
// so the retry loop is being exercised from day one rather than waiting for a
// backend to prove itself against.
//
// THIS IS THE ONE ROUTE THAT CARRIES USER CONTENT. `services/telemetry.ts`
// exists under a whitelist test that fails if an eighth field appears, because
// telemetry is data the app gathers on its own initiative and the Privacy
// Centre promises it is counts only. A problem report is the opposite: the
// user wrote every word of it, chose every file on it, and pressed a button
// labelled Send. What that changes is the CONSENT BASIS, not the discipline —
// this file still sends only the four things the user typed or picked
// (`title`, `description`, `topic`, their files) plus the report's own id.
// It attaches no ledger data, no wallet names, no captured notification text,
// and no device identifier: `apiClient`'s request interceptor already limits
// the headers to version context (`services/device_info.ts`), and there is
// deliberately no field here to defeat that from the body.
//
// `reportId` IS AN IDEMPOTENCY KEY, and the reason this route can be retried
// at all. A send that succeeds server-side and then loses its response to a
// dropped connection is indistinguishable, from here, from one that never
// arrived — so the client retries, and the server is expected to recognise a
// `reportId` it already holds and answer with the ORIGINAL ticket instead of
// opening a second one. Migration 015's header records the same contract from
// the storage end.
//
// THE OUTCOME IS A UNION, NOT A BOOLEAN. "Failed" is two different facts here:
// a phone with no signal (try again in a minute, forever if that is what it
// takes) and a request the server will refuse identically every time (stop,
// and tell the user). Collapsing them into `false` is what would turn a
// malformed report into an endless background retry nobody can see.
import type { AxiosResponse } from "axios";

import { apiClient } from "@/services/api";
import type { SupportReport } from "@/types/support";

/** The route this feature owns. Relative to `ENV.API_URL` (constants/env.ts). */
export const SUPPORT_REPORTS_PATH = "/v1/support/reports";

/**
 * Longer than `apiClient`'s 30s default, because this is the only request in
 * the app that uploads files. Twenty megabytes of screenshots over Philippine
 * mobile data does not finish in thirty seconds, and timing out mid-upload
 * would burn the whole transfer and start the schedule over — the one failure
 * mode where retrying costs the user real data allowance.
 */
const UPLOAD_TIMEOUT_MS = 3 * 60_000;

/**
 * What happened to one send attempt.
 *
 * `retry` and `rejected` are both failures; the difference is whether waiting
 * could change the answer. See this file's header.
 */
export type SupportSendOutcome =
  | { kind: "sent"; ticketRef: string | null }
  | { kind: "retry"; reason: string }
  | { kind: "rejected"; reason: string };

/**
 * React Native's `FormData` accepts this file descriptor object; the DOM
 * lib's `append(name, value: string | Blob)` describes the browser's
 * implementation, not RN's. The cast in `buildFormData` is that platform gap
 * and nothing else — there is no runtime check to write, because the value
 * never becomes a `Blob` at any point.
 */
export type ReactNativeFilePart = { uri: string; name: string; type: string };

/** One multipart field: a name and either a plain value or a file descriptor. */
export type SupportReportPart = [string, string | ReactNativeFilePart];

function fileNameFor(fileUri: string, index: number): string {
  const lastSegment = fileUri.split("/").pop();
  return lastSegment !== undefined && lastSegment.length > 0
    ? lastSegment
    : `attachment-${index + 1}`;
}

/**
 * Every field that goes on the wire, as plain data.
 *
 * SPLIT OUT OF `FormData` SO THE WHITELIST IS TESTABLE. Under Jest the global
 * `FormData` is Node's spec implementation, which has no readable parts array
 * and coerces a file-descriptor object to the string "[object Object]" —
 * React Native's own polyfill does neither. Asserting against a `FormData`
 * therefore either tests Node's behaviour (which never runs on a phone) or
 * tests nothing. This function is what the privacy whitelist in
 * `services/__tests__/support_reports.test.ts` actually pins, and
 * `buildFormData` below is the one line that turns it into a request body.
 */
export function supportReportParts(report: SupportReport): SupportReportPart[] {
  const parts: SupportReportPart[] = [
    ["reportId", report.id],
    ["title", report.title],
    ["description", report.description],
    ["topic", report.topic],
    // When the user WROTE it, not when it finally got through. A ticket
    // timestamped by delivery would date a bug report to whenever the phone
    // next found signal, which on this app's target network can be days after
    // the bug.
    ["createdAt", String(report.createdAt)],
    // How many sends it took. Not diagnostics for the developer's sake — it is
    // how the server tells a first delivery from a retry of one it may already
    // hold, alongside `reportId`.
    ["attemptCount", String(report.attemptCount)],
  ];

  report.attachments.forEach((attachment, index) => {
    parts.push([
      "attachments",
      {
        uri: attachment.fileUri,
        name: fileNameFor(attachment.fileUri, index),
        type: attachment.mimeType,
      },
    ]);
  });

  return parts;
}

function buildFormData(report: SupportReport): FormData {
  const form = new FormData();
  for (const [name, value] of supportReportParts(report)) {
    // The cast is the platform gap described above `ReactNativeFilePart` — a
    // plain string needs none of it, and never takes this branch.
    form.append(name, typeof value === "string" ? value : (value as unknown as Blob));
  }
  return form;
}

/**
 * Reads the ticket id out of a successful response, if the server sent one.
 *
 * DEFENSIVE, because the server does not exist yet and this is the field most
 * likely to be named something else by the time it does. A 2xx with an
 * unreadable body still means the ticketing system holds the report — the
 * report is marked sent with a `null` ticket reference rather than being
 * retried into a duplicate.
 */
function readTicketRef(response: AxiosResponse<unknown>): string | null {
  const body: unknown = response.data;
  if (typeof body !== "object" || body === null) return null;
  const candidate = "ticketId" in body ? body.ticketId : "ticketRef" in body ? body.ticketRef : null;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

/**
 * Maps an HTTP status onto the retry decision.
 *
 * 408 (request timeout), 425 (too early) and 429 (rate limited) are 4xx codes
 * that explicitly mean "later", so they retry despite their class. Every other
 * 4xx is the server saying this exact payload is unacceptable — a malformed
 * body, a description over a length the server enforces, an attachment it will
 * not take — and sending it again unchanged just repeats the answer.
 *
 * 5xx and anything unrecognised retry: a server that is broken now may not be
 * in eight minutes, and this queue's whole disposition is to keep the report
 * rather than assume.
 */
function outcomeForStatus(status: number): SupportSendOutcome {
  if (status === 408 || status === 425 || status === 429) {
    return { kind: "retry", reason: "The server asked us to try later." };
  }
  if (status >= 400 && status < 500) {
    return { kind: "rejected", reason: `The server could not accept this report (${status}).` };
  }
  return { kind: "retry", reason: `Server error ${status}.` };
}

/**
 * Sends one report. Never throws — every failure comes back as a `retry` or a
 * `rejected` outcome, because the caller is a background flush whose job is to
 * update a row, not to have an opinion about exceptions.
 *
 * `reason` strings are written for the user's own screen ("No connection"),
 * not for a log: `support_reports.last_error` is rendered on the report list,
 * so a raw axios message or a response body — which can contain whatever the
 * server chose to put in it — must never end up in one.
 */
export async function sendSupportReport(report: SupportReport): Promise<SupportSendOutcome> {
  try {
    const response = await apiClient.post<unknown>(SUPPORT_REPORTS_PATH, buildFormData(report), {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: UPLOAD_TIMEOUT_MS,
    });

    if (response.status >= 200 && response.status < 300) {
      return { kind: "sent", ticketRef: readTicketRef(response) };
    }
    return outcomeForStatus(response.status);
  } catch {
    // `apiClient`'s response interceptor rejects with `{ status: 0, message }`
    // for a request that never reached a server at all — the offline case, and
    // the reason this feature exists. Deliberately not reading `message` into
    // the reason: it is an axios/native string ("Network Error", or a URL in
    // some cases), and this value is rendered.
    return { kind: "retry", reason: "No connection." };
  }
}
