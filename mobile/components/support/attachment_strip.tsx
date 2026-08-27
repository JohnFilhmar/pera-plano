// components/support/attachment_strip.tsx — the screenshots on a report being
// written, and the control that adds more.
//
// THUMBNAILS, NOT FILENAMES. The files are named after UUIDs
// (`lib/support/attachments.ts` renames every copy, so two screenshots taken a
// second apart cannot collide), which means a filename list would read as five
// identical rows of hex. A user removing the wrong screenshot from a bug report
// only finds out about it after the ticket is filed, so the strip shows the
// picture.
//
// VIDEO GETS A PLACEHOLDER TILE, not a frame. Rendering the first frame of a
// video needs a thumbnailing library this app does not carry, and a black
// `Image` that silently fails to load looks like a bug in the bug reporter.
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { ImagePlus, Play, X } from "lucide-react-native";

import { registerIcon } from "@/components/ui/button";
import { MAX_SUPPORT_ATTACHMENTS } from "@/lib/support/attachments";
import type { NewSupportReportAttachment } from "@/types/support";

const AddIcon = registerIcon(ImagePlus);
const RemoveIcon = registerIcon(X);
const VideoIcon = registerIcon(Play);

/**
 * NOT `lib/ui/hit_slop.ts`'s `ISOLATED_LINK_HIT_SLOP`, which that file's own
 * doc reserves for controls with no interactive neighbour within its 16px.
 * These buttons have one: the next tile's remove button sits 8px of gap plus
 * a tile width away, and the add tile sits beside the last one. 10px lifts the
 * 24dp control to 44dp of touch target without either edge reaching a
 * neighbour's.
 */
const REMOVE_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export type AttachmentStripProps = {
  attachments: readonly NewSupportReportAttachment[];
  onAdd: () => void;
  onRemove: (fileUri: string) => void;
  /** Disables the add tile while a pick or a copy is in flight. */
  busy?: boolean;
  testID?: string;
};

export function AttachmentStrip({
  attachments,
  onAdd,
  onRemove,
  busy = false,
  testID = "support-attachments",
}: AttachmentStripProps) {
  const atLimit = attachments.length >= MAX_SUPPORT_ATTACHMENTS;

  return (
    <View testID={testID} className="gap-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {attachments.map((attachment) => (
          <View key={attachment.fileUri} className="h-20 w-20">
            {attachment.mimeType.startsWith("video/") ? (
              <View className="h-20 w-20 items-center justify-center rounded-xl bg-chip dark:bg-chip-dark">
                <VideoIcon size={22} className="text-fg-2 dark:text-fg-2-dark" />
              </View>
            ) : (
              <Image
                testID={`support-attachment-${attachment.fileUri}`}
                source={{ uri: attachment.fileUri }}
                className="h-20 w-20 rounded-xl bg-chip dark:bg-chip-dark"
                resizeMode="cover"
              />
            )}
            <Pressable
              testID={`support-attachment-remove-${attachment.fileUri}`}
              accessibilityRole="button"
              accessibilityLabel="Remove attachment"
              hitSlop={REMOVE_HIT_SLOP}
              onPress={() => onRemove(attachment.fileUri)}
              // Pinned to the tile's corner rather than sitting under it: a
              // horizontal strip has no vertical room for a second row of
              // controls, and 44dp of hit slop makes the small target real.
              className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-fg dark:bg-fg-dark"
            >
              <RemoveIcon size={14} className="text-bg dark:text-bg-dark" />
            </Pressable>
          </View>
        ))}

        {atLimit ? null : (
          <Pressable
            testID="support-attachment-add"
            accessibilityRole="button"
            accessibilityLabel="Add a screenshot"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onAdd}
            className="h-20 w-20 items-center justify-center rounded-xl border border-dashed border-line dark:border-line-dark"
          >
            <AddIcon size={20} className="text-fg-2 dark:text-fg-2-dark" />
          </Pressable>
        )}
      </ScrollView>

      <Text className="text-micro text-fg-2 dark:text-fg-2-dark">
        {atLimit
          ? `That's the limit of ${MAX_SUPPORT_ATTACHMENTS} files.`
          : "Screenshots help a lot. Up to 5 files."}
      </Text>
    </View>
  );
}
