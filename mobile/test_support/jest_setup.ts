// THE SUITE'S TIME ZONE, PINNED — first statement in the file, before any
// module here constructs a Date.
//
// This app is built for one country and its calendar arithmetic is LOCAL
// throughout: `localDateKey` groups the ledger by the local day, `toDateIso`
// stamps a local date, and every fixture written as `new Date(y, m, d, h)` is
// a local instant. Without a pin those all resolve against whatever the
// running machine happens to be set to, which has two consequences and both
// are bad. On a UTC or west-of-Greenwich box a test can fail for a reason that
// has nothing to do with the code. Worse, and the reason this line exists: on
// a box that happens to sit in +08:00 a test written to prove local-vs-UTC
// handling can pass while proving nothing, because the fixture it chose lands
// on the same calendar day in both. A pinned zone makes the difference between
// those two readings a property of the FIXTURE, which a test author can then
// choose deliberately (see the 7am fixture in
// components/transactions/__tests__/ledger_list.test.tsx).
//
// Asia/Manila (+08:00, no DST) is the product's own zone — see lib/dates.ts.
//
// THE PIN THAT ACTUALLY WORKS LIVES IN `jest_global_setup.ts`. This assignment
// is kept only so a reader of a setup file is not left wondering where the zone
// comes from; by the time this runs the worker's Node has already resolved its
// zone and cached it, so this line changes nothing.
//
// This comment used to claim the opposite: "Node 16+ re-reads `process.env.TZ`
// on the next Date operation, so assigning it here is enough; there is no
// cached-offset trap". That is FALSE, and it went unnoticed for five waves
// because the machine this suite is developed on is already in Asia/Manila, so
// the no-op agreed with the answer. The first CI run on a Linux runner failed
// `localDateKey keys by the LOCAL calendar day, not by UTC` on its explicit
// `toISOString()` guard — the guard working as designed. Reproduce the old
// behaviour by deleting `globalSetup` from package.json and running
// `TZ=UTC npx jest ledger_list`.
process.env.TZ = "Asia/Manila";

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
