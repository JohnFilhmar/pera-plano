// lib/support/attachment_picker.ts — the app's only import of
// `expo-image-picker`.
//
// ONE FILE, ONE NATIVE IMPORT. `expo-image-picker` is a native module: it has
// no implementation under Jest, and a value import of it pulls
// `requireNativeModule` into every module that transitively touches it — the
// exact trap `lib/db/table_names.ts`'s header documents for the notification
// listener. Keeping the import here means the report form, the repository and
// the outbox runner all stay requirable in a plain test, and one `jest.mock`
// of this module covers the whole feature.
//
// IT RETURNS PLAIN DATA, not the picker's own result type. Everything
// downstream (`lib/support/attachments.ts`, the form's state) speaks
// `{ uri, mimeType }` and knows nothing about assets, EXIF, or cancellation
// flags. That is what lets the picker be swapped — for a document picker, for
// a camera capture, for a "share to PeraPlano" intent — without any of them
// changing.
//
// NO ANDROID MEDIA PERMISSION IS ASKED FOR, AND NONE IS DECLARED. Since
// Android 13 `launchImageLibraryAsync` goes through the system photo picker,
// which returns exactly the files the user chose in a UI the app never sees
// and requires no permission at all; older devices fall back to the storage
// access framework, which also requires none. `app.json` therefore lists
// `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and
// `READ_MEDIA_VISUAL_USER_SELECTED` under `blockedPermissions`, so the
// `expo-image-picker` config plugin cannot quietly add a
// read-your-whole-gallery permission to the manifest of an app whose Privacy
// Centre is one of its selling points. The consequence is that
// `requestMediaLibraryPermissionsAsync` must NOT be called on Android — with
// the permissions blocked it can only answer "denied", which would turn a
// working picker into a permanent error message.
import { Platform } from "react-native";

import * as ImagePicker from "expo-image-picker";

import { MAX_SUPPORT_ATTACHMENTS } from "@/lib/support/attachments";

/** A file the user chose, before it has been copied anywhere. */
export type PickedMedia = {
  uri: string;
  mimeType: string;
};

/**
 * Raised when the user has turned photo access off and the OS will not ask
 * again. The message is user-facing — the form renders it and points at
 * system settings.
 */
export class MediaPermissionDeniedError extends Error {
  constructor() {
    super("PeraPlano needs permission to open your photos before it can attach one.");
    this.name = "MediaPermissionDeniedError";
  }
}

/**
 * Opens the system media picker and returns what the user chose. An empty
 * array means they backed out — cancellation is a normal answer here, not an
 * error, so the form has nothing to catch on the common path.
 *
 * `remainingSlots` caps the multi-select at what the report can still hold, so
 * the OS itself stops the user at the limit rather than this app accepting six
 * files and then rejecting the sixth after they picked it.
 *
 * NO EDITING, AND NO RE-ENCODING. `allowsEditing` would put a crop UI in front
 * of someone trying to show us a bug, and re-encoding a screenshot to save
 * bandwidth is how the illegible text in the screenshot stops being the
 * evidence it was attached to be. `quality: 1` for the same reason — the size
 * caps in `attachments.ts` are the bandwidth control, applied to the file as
 * it actually is.
 */
export async function pickSupportMedia(remainingSlots: number): Promise<PickedMedia[]> {
  const slots = Math.max(1, Math.min(remainingSlots, MAX_SUPPORT_ATTACHMENTS));

  // iOS only — see the note at the top of this file for why Android must not
  // be asked. This app ships Android-only today; the branch is here so the
  // first iOS build does not silently open a picker the OS will refuse.
  if (Platform.OS === "ios") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new MediaPermissionDeniedError();
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: slots,
    quality: 1,
  });

  if (result.canceled) return [];

  return result.assets.map((asset) => ({
    uri: asset.uri,
    // The picker leaves `mimeType` undefined on some Android providers. A
    // screenshot is overwhelmingly a PNG, and guessing wrong costs a wrong
    // file extension on the ticket rather than a failed upload — the server
    // reads the bytes, not this string.
    mimeType: asset.mimeType ?? "image/png",
  }));
}
