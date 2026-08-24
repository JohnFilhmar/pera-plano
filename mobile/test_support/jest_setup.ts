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

// react-native-keyboard-controller (app/_layout.tsx's KeyboardProvider) reads
// a native event emitter at module load time — there is no native module
// under Jest, so even importing it throws ("doesn't seem to be linked")
// without this. The package ships its own official Jest mock for exactly
// this reason (its docs' "Testing" section) — swap in the real native module
// only, not our own wiring around it.
jest.mock("react-native-keyboard-controller", () =>
  require("react-native-keyboard-controller/jest"),
);
