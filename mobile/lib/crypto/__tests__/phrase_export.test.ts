// lib/crypto/__tests__/phrase_export.test.ts — the one way the recovery words
// are allowed to leave their screen.
//
// WHY THIS FILE EXISTS AT ALL. `83b1253` removed the share action because it
// handed twelve words to whichever third-party app the user tapped, plus
// Android's share history and usually a clipboard on the way. The owner asked
// for an affordance back rather than making people hand-copy twelve words, so
// what is under test here is not "can we export" but "does the route carry the
// properties it was reintroduced with": the user picks the destination, a
// declined picker writes nothing, and the file explains itself to whoever finds
// it later.
//
// There is deliberately no clipboard test, because there is deliberately no
// clipboard path -- see phrase_export.ts's header for why a Copy button was
// dropped on this SDK rather than shipped without its mitigation.

// expo-file-system is a native module Jest cannot require — the same treatment
// lib/privacy/__tests__/data_export.test.ts gives it, for the same reason.
jest.mock("expo-file-system/legacy", () => ({
  writeAsStringAsync: jest.fn(async () => undefined),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(async () => ({
      granted: true,
      directoryUri: "content://tree/primary%3ADocuments",
    })),
    createFileAsync: jest.fn(async () => "content://tree/primary%3ADocuments/document/words.txt"),
  },
}));

import * as FileSystem from "expo-file-system/legacy";

import { phraseFileContents, savePhraseToFile } from "@/lib/crypto/phrase_export";

const WORDS = [
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  "absurd",
  "abuse",
  "access",
  "accident",
];

beforeEach(() => {
  jest.clearAllMocks();
});

// ORDER IS PART OF THE SECRET. BIP-39 derives a different key from the same
// words in a different sequence, so a file that loses the numbering is a file
// that no longer opens anything.
test("the saved file carries every word, in order, numbered", () => {
  const contents = phraseFileContents(WORDS);

  WORDS.forEach((word, index) => {
    expect(contents).toContain(`${index + 1}. ${word}`);
  });
});

// A file the user finds in six months with no idea what it is gets deleted, or
// worse, gets shared. It has to say what it opens and what holding it means.
test("the saved file says what it is and what holding it means", () => {
  const contents = phraseFileContents(WORDS);

  expect(contents).toContain("PeraPlano");
  expect(contents.toLowerCase()).toContain("anyone");
});

test("a granted folder gets the file written into it", async () => {
  const outcome = await savePhraseToFile(WORDS);

  expect(outcome).toBe("saved");
  expect(FileSystem.StorageAccessFramework.createFileAsync).toHaveBeenCalledWith(
    "content://tree/primary%3ADocuments",
    expect.any(String),
    "text/plain",
  );
  const [uri, contents] = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
  expect(uri).toBe("content://tree/primary%3ADocuments/document/words.txt");
  expect(contents).toContain("abandon");
});

// DECLINING THE PICKER IS NOT AN ERROR. A user who backs out of the folder
// chooser has said "not this way", and a thrown error there would put a failure
// message on a screen where nothing failed.
test("declining the folder picker writes nothing and reports cancelled", async () => {
  (
    FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock
  ).mockResolvedValueOnce({ granted: false, directoryUri: null });

  const outcome = await savePhraseToFile(WORDS);

  expect(outcome).toBe("cancelled");
  expect(FileSystem.StorageAccessFramework.createFileAsync).not.toHaveBeenCalled();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
});
