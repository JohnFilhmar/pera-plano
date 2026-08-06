// AsyncStorage has no native module under jest — use its official in-memory mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-crypto is a native module; node's crypto provides the same UUIDv4 API.
jest.mock("expo-crypto", () => ({
  randomUUID: () => require("crypto").randomUUID(),
}));
