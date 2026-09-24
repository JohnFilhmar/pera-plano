// mobile/lib/ai/eval/__tests__/resident_memory.test.ts
//
// The reader is native, so this pins the two things Jest can see: which file
// is asked for, and what comes back from a real-shaped status text or a failed
// read.
jest.mock("expo-file-system", () => ({
  // A plain field, never a parameter property: babel-plugin-jest-hoist rejects
  // the factory otherwise.
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    textSync(): string {
      mockReads.push(this.uri);
      if (mockStatus instanceof Error) throw mockStatus;
      return mockStatus;
    }
  },
}));

import { parseVmRssBytes, readResidentBytes } from "../resident_memory";

let mockStatus: string | Error = "";
const mockReads: string[] = [];

/** Trimmed from a real `/proc/<pid>/status`. VmHWM and VmPeak sit nearby on purpose. */
const STATUS = [
  "Name:\tperaplano.dev",
  "VmPeak:\t 9876543 kB",
  "VmHWM:\t 1500000 kB",
  "VmRSS:\t 1402670 kB",
  "RssFile:\t  900000 kB",
].join("\n");

beforeEach(() => {
  mockReads.length = 0;
});

test("VmRSS is read in KiB and returned in bytes, never the peak lines around it", () => {
  expect(parseVmRssBytes(STATUS)).toBe(1_402_670 * 1024);
});

test("the sample comes from this process's own status file", () => {
  mockStatus = STATUS;
  expect(readResidentBytes()).toBe(1_402_670 * 1024);
  expect(mockReads).toEqual(["file:///proc/self/status"]);
});

test("an unreadable file or a missing line is 0, which the screen shows as not measured", () => {
  mockStatus = new Error("EACCES");
  expect(readResidentBytes()).toBe(0);

  mockStatus = "Name:\tperaplano.dev\n";
  expect(readResidentBytes()).toBe(0);
});
