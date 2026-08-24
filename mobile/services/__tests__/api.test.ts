// services/__tests__/api.test.ts — the transport for the MVP's only two
// server calls (M3c Task 4). Nothing here mocks a module with a jest.fn()
// factory: `apiClient` is a real axios instance, and every request below
// supplies its own `adapter` — axios's own supported way to swap out the
// transport per call — so no test ever opens a socket, which matters
// because the server this hits does not exist yet (see task-4-brief.md) and
// won't for the foreseeable future either: offline is this app's normal
// operating condition, not a test-only stand-in for one.
import { Platform } from "react-native";

import Constants from "expo-constants";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";

import { ENV } from "@/constants/env";

import { apiClient } from "../api";
import { getDeviceHeaders } from "../device_info";

/** Exactly the four header names the two public endpoints are allowed to see. */
const EXPECTED_DEVICE_HEADER_KEYS = ["X-App-Version", "X-Client-Type", "X-Device-OS", "X-Device-OS-Version"].sort();

/** Resolves every request with the given status — never opens a socket. */
function respondWith(status: number, data: unknown = {}): AxiosAdapter {
  return async (config) => ({ data, status, statusText: "", headers: {}, config });
}

/** Fails the way a real connection failure does: rejects with no `.response` at all. */
function failNetwork(message: string): AxiosAdapter {
  return async () => {
    throw new Error(message);
  };
}

/** Resolves 200 while handing the fully-resolved request config to `sink`. */
function capture(sink: { config?: InternalAxiosRequestConfig }): AxiosAdapter {
  return async (config) => {
    sink.config = config;
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  };
}

describe("apiClient", () => {
  it("takes its base URL from ENV", () => {
    expect(apiClient.defaults.baseURL).toBe(ENV.API_URL);
  });

  it("validateStatus accepts a 404 without throwing — a normal answer, not an exception", async () => {
    const response = await apiClient.get("/parser-rules", { adapter: respondWith(404) });
    expect(response.status).toBe(404);
  });

  it("rejects a network failure with { status: 0, message }, not a thrown AxiosError", async () => {
    await expect(
      apiClient.get("/insight", { adapter: failNetwork("Network Error") }),
    ).rejects.toEqual({ status: 0, message: "Network Error" });
  });

  it("never attaches an Authorization header — the MVP calls only public endpoints", async () => {
    const sink: { config?: InternalAxiosRequestConfig } = {};
    await apiClient.get("/insight", { adapter: capture(sink) });
    expect(sink.config?.headers.get("Authorization")).toBeUndefined();
  });
});

describe("getDeviceHeaders", () => {
  it("includes the app version and the device OS, read from Expo/RN, not hardcoded", async () => {
    const headers = await getDeviceHeaders();
    expect(headers["X-App-Version"]).toBe(Constants.expoConfig?.version ?? "unknown");
    expect(headers["X-Device-OS"]).toBe(Platform.OS);
    expect(headers["X-Device-OS-Version"]).toBe(String(Platform.Version));
  });

  it("PRIVACY REGRESSION: carries no identifier field — nothing that could correlate two requests to one handset", async () => {
    const headers = await getDeviceHeaders();
    expect(Object.keys(headers).sort()).toEqual(EXPECTED_DEVICE_HEADER_KEYS);
  });
});
