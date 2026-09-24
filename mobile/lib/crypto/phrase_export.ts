// lib/crypto/phrase_export.ts — the one way the recovery words are allowed to
// leave their screen, and why it is that one.
//
// THIS FILE REOPENS A DOOR `83b1253` CLOSED, DELIBERATELY AND NARROWER. That
// commit removed the share action because it handed twelve words to whichever
// third-party app the user tapped, plus Android's share history and usually a
// clipboard on the way there, and it left "write them on paper" as the only way
// off the screen. The owner's call, 2026-09-08: hand-copying twelve words is
// too much to ask of every user at first run, and an affordance comes back.
//
// SAVING, AND NOT COPYING, AND THAT WAS A DECISION RATHER THAN AN OVERSIGHT.
// The plan was a Copy button beside this one, made acceptable by Android's
// `ClipDescription.EXTRA_IS_SENSITIVE`, which hides the paste preview on 13+
// and keeps the words out of Gboard's clipboard history. That flag is exposed
// by expo-clipboard's `isSensitive` option -- which does NOT exist in
// `expo-clipboard@8.0.8`, the version Expo SDK 54 pins. Its `SetStringOptions`
// carries exactly one field, `inputFormat`. The flag ships in the 57.x line,
// which is SDK 57, and installing that here is a cross-SDK mismatch.
//
// So a Copy button on this SDK would be the ORIGINAL leak with none of the
// mitigation that justified reopening it, and it was dropped rather than
// shipped without the flag. If it comes back it needs either an SDK upgrade or
// a small native shim of our own (this repo already ships a local expo module,
// modules/notification_listener, so that is precedented rather than novel).
//
// WHY SAVING IS DIFFERENT FROM SHARING, since both move the words off-screen:
// the Storage Access Framework asks the USER for a destination folder and hands
// this app a one-shot URI to write into. No third-party app receives the words,
// nothing enters Android's share history, no clipboard is involved, and the app
// keeps no standing permission it could write to again unprompted.
//
// WHAT IS STILL TRUE, AND IS NOT PRETENDED OTHERWISE IN THE UI: a file is only
// as private as the folder the user puts it in. The screen's copy says that
// rather than claiming the words are safe once saved.
//
// IT LIVES BESIDE recovery_phrase.ts rather than in a generic io/ module
// because what it handles is one specific secret with one specific threat
// model, and the next reader looking for "where can the phrase go" should find
// generation and egress in the same directory.
import * as FileSystem from "expo-file-system/legacy";

/**
 * The file the user ends up with. No date or device name in it: this is a
 * secret, and a filename that says when and where it was made is a filename
 * that helps someone browsing a shared Drive folder decide it is worth opening.
 */
export const PHRASE_FILE_NAME = "peraplano-recovery-words";

/** Whether the user went through with the folder picker. */
export type PhraseSaveOutcome = "saved" | "cancelled";

/**
 * What actually goes in the file.
 *
 * IT EXPLAINS ITSELF, because the file outlives the moment. A user who finds
 * `peraplano-recovery-words.txt` in their Documents folder in six months needs
 * to know, from the file alone, that it opens their financial history and that
 * anyone holding it can do the same. A bare list of twelve words gets deleted
 * as junk, or worse, gets shared as a curiosity.
 *
 * The words are numbered because their ORDER is part of the secret: BIP-39
 * derives a different key from the same words in a different sequence, so a
 * file that loses the order is a file that no longer opens anything.
 */
export function phraseFileContents(words: readonly string[]): string {
  const numbered = words.map((word, index) => `${index + 1}. ${word}`).join("\n");

  return [
    "PeraPlano recovery words",
    "",
    "These words are the only other way into the PeraPlano data on this phone.",
    "Anyone who has them can open it. PeraPlano cannot recover them for you, and",
    "cannot open your data without them.",
    "",
    "Keep this file somewhere only you can reach. The order matters.",
    "",
    numbered,
    "",
  ].join("\n");
}

/**
 * Writes the words into a folder the user chooses.
 *
 * THE USER PICKS THE DESTINATION AND THAT IS THE POINT. The app never decides
 * where a copy of the ledger's second key lands: the Storage Access Framework
 * hands the choice to the person whose secret it is, who can put it in a
 * password manager's folder, a cloud drive, or an SD card.
 *
 * DECLINING IS AN OUTCOME, NOT AN ERROR. A user who backs out of the picker has
 * said "not this way"; throwing there would put a failure message on a screen
 * where nothing failed. The caller shows a confirmation for `saved` and stays
 * quiet for `cancelled`.
 */
export async function savePhraseToFile(words: readonly string[]): Promise<PhraseSaveOutcome> {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return "cancelled";

  const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    PHRASE_FILE_NAME,
    "text/plain",
  );

  await FileSystem.writeAsStringAsync(fileUri, phraseFileContents(words));
  return "saved";
}
