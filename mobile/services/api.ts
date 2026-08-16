// services/api.ts — HTTP client for the MVP's only two server calls (M3c
// Task 4).
//
// THE SERVER DOES NOT EXIST YET. `server/` is 15 tasks of work scheduled
// after the mobile MVP, so every request this client makes runs against
// nothing — which, for the foreseeable future, is the actual runtime
// condition, not a gap this file works around. Being offline is the
// expected state on Philippine mobile data (dropped signal on a bus, a
// tunnel, a brownout), not a fault: see the response interceptor below.
//
// NO AUTH INTERCEPTOR, DELIBERATELY. The MVP calls only public endpoints.
// Wiring token plumbing in now would be dead code guarding nothing — worse,
// it would be a place a future change could start attaching credentials
// without anyone noticing. This file gains an interceptor when cloud backup
// ships and the server has something worth authenticating against.
// Guarded by services/__tests__/api.test.ts's "never attaches an
// Authorization header" regression test.
import axios, { type AxiosInstance } from "axios";

import { ENV } from "@/constants/env";

import { getDeviceHeaders } from "./device_info";

const apiClient: AxiosInstance = axios.create({
  baseURL: ENV.API_URL,
  timeout: 30000,
  // Callers inspect `response.status` themselves rather than catching: a
  // 404 from the parser-rules endpoint means "no newer ruleset" — a normal
  // answer, not an exception.
  validateStatus: () => true,
});

// Every request carries version-context headers so the server can reason
// about client compatibility. Never a device or install identifier — see
// device_info.ts.
apiClient.interceptors.request.use(async (config) => {
  Object.assign(config.headers, await getDeviceHeaders());
  return config;
});

// A network failure — no HTTP response reached us at all: DNS, timeout,
// connection refused — rejects with a plain { status: 0, message } and logs
// at warn, never error. An app that logs an error every time a bus goes
// through a tunnel trains everyone to ignore its logs. (A real HTTP
// response, including 4xx/5xx, already passed `validateStatus` above and
// resolves normally; it never reaches this rejection branch.)
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const message =
      typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : "Network request failed.";
    console.warn("[api] request failed — device may be offline", message);
    return Promise.reject({ status: 0, message });
  },
);

export { apiClient };
