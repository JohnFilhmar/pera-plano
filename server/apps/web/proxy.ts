import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, readOrCreateRequestId } from "@peraplano/common";

/**
 * One id per request, echoed back so a report of "this page was wrong at 14:02" can be
 * matched to a log line. Nothing else: this site has no sessions, no cookies and no auth,
 * and code that runs before every request on a privacy site is a liability in proportion
 * to how much it does.
 *
 * The file is `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and the old
 * name prints a deprecation warning on every production build. Same runtime, same matcher
 * semantics, different export name.
 *
 * This runs on Next's Edge runtime, which is why readOrCreateRequestId uses
 * globalThis.crypto rather than node:crypto (see the correlation module's own comment).
 */
export function proxy(request: NextRequest): NextResponse {
  const requestId = readOrCreateRequestId(request.headers);
  const response = NextResponse.next();
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
