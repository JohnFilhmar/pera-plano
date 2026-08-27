// NOTE on package.json's jest.moduleNameMapper entry for "^lucide-react-native$":
// lucide-react-native ships ESM-only at its default entry point, which Jest 29
// cannot parse (a bare `export ... from './icons/...mjs'` throws a syntax
// error). The mapper redirects the import to the package's own CJS build
// (dist/cjs/lucide-react-native.js). Do not remove it — every icon-bearing
// test breaks with an unrelated-looking ESM parse error without it.

// AsyncStorage has no native module under jest — use its official in-memory mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-crypto is a native module; node's crypto provides the same UUIDv4 API
// and, via randomBytes, the same CSPRNG guarantee getRandomBytesAsync makes
// on-device (recovery_phrase.ts's whole reason for using expo-crypto instead
// of Math.random is that guarantee — the mock must not weaken it).
jest.mock("expo-crypto", () => ({
  randomUUID: () => require("crypto").randomUUID(),
  getRandomBytesAsync: (byteCount: number) =>
    Promise.resolve(new Uint8Array(require("crypto").randomBytes(byteCount))),
}));

// expo-file-system is a native module with no JS implementation — importing it
// under Jest throws, which used to be contained to the two export flows
// (lib/privacy/data_export.ts, lib/reports/csv_export.ts) and their own
// per-suite mocks. Offline problem reporting widened the blast radius:
// lib/support/attachments.ts writes attachment files, and lib/bootstrap.ts and
// lib/privacy/data_wipe.ts both reach it transitively, so a suite that only
// wanted to render the More hub would now die at module load. Project-wide,
// for the same reason AsyncStorage and expo-crypto are above.
//
// INERT ON PURPOSE. Nothing here writes, reads or remembers anything: a suite
// that cares what happened to a file registers its own `jest.mock` with a
// factory it can assert against (data_export.test.ts, csv_export.test.ts and
// lib/support/__tests__/attachments.test.ts all do), and a suite-level mock
// overrides this one. `documentDirectory`/`cacheDirectory` are non-null so
// the "no directory" guards in the modules above stay on their happy path.
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///test-documents/",
  cacheDirectory: "file:///test-cache/",
  EncodingType: { UTF8: "utf8" },
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ""),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 0 })),
}));

// react-native-keyboard-controller (app/_layout.tsx's KeyboardProvider) reads
// a native event emitter at module load time — there is no native module
// under Jest, so even importing it throws ("doesn't seem to be linked")
// without this. The package ships its own official Jest mock for exactly
// this reason (its docs' "Testing" section) — swap in the real native module
// only, not our own wiring around it.
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);
