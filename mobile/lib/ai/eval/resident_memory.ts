// mobile/lib/ai/eval/resident_memory.ts
//
// THE EVAL'S MEMORY SAMPLE: this process's VmRSS from /proc/self/status, which
// an Android app may read for itself. `File.textSync` is the reader because its
// Android side reads the stream to the end; /proc reports every file's size as
// 0, so a reader that sized its buffer by length would return nothing.
import { File } from "expo-file-system";

/**
 * Pulls `VmRSS` out of a `/proc/<pid>/status` text.
 *
 * @param status - The file's whole text.
 * @returns Resident set size in bytes (the kernel's kB are KiB), or 0 when the
 *   text has no `VmRSS` line.
 */
export function parseVmRssBytes(status: string): number {
  const match = /^VmRSS:\s*(\d+)\s*kB/m.exec(status);
  return match === null ? 0 : Number(match[1]) * 1024;
}

/**
 * This process's resident set size right now, read synchronously so the eval
 * runner can sample it once per question.
 *
 * @returns Bytes, or 0 when /proc cannot be read on this platform or build.
 *   The eval screen shows 0 as "not measured", never as a reading.
 */
export function readResidentBytes(): number {
  try {
    return parseVmRssBytes(new File("file:///proc/self/status").textSync());
  } catch {
    return 0;
  }
}
