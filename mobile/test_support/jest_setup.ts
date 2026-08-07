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

// expo-crypto is a native module; node's crypto provides the same UUIDv4 API.
jest.mock("expo-crypto", () => ({
  randomUUID: () => require("crypto").randomUUID(),
}));
