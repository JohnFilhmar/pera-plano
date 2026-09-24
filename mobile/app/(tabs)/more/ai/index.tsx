// app/(tabs)/more/ai/index.tsx — the Assistant screen. Route: /more/ai.
//
// PLACEMENT IS A DESIGN DECISION, NOT A FILING ONE. Spec §4.9: "More →
// Assistant. Not a tab — it is optional, most users will not have a model, and
// a permanently empty tab is a permanent reproach." Nested under
// app/(tabs)/more/ for the same reason every other screen there is (see
// more/_layout.tsx): a route registered as a direct child of the tab navigator
// grows its own tab button.
//
// ALL ORCHESTRATION LIVES HERE, NOT IN THE COMPONENTS — the split
// more/privacy.tsx already uses. `components/ai/chat_surface.tsx` receives a
// bridge, a tool runner and a phase; it never reaches for the downloader, the
// catalogue, the model file or AsyncStorage.
//
// THE SCREEN OPENS IN "waking", NOT IN "no_model". Spec §6 risk 10: the picker
// must never flash at a user who already has a model, and on a cold start after
// Android has reclaimed the process, whether a model exists is not known until
// the disk has been read. Guessing "no model" for those few hundred
// milliseconds shows a download list to someone holding 2.5 GB of downloaded
// weights, which is the exact failure risk 10 names.
import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Text, View } from "react-native";

import { ChatSurface, type SurfacePhase } from "@/components/ai/chat_surface";
import { ModelPicker } from "@/components/ai/model_picker";
import { registerIcon } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { useModelDownload } from "@/hooks/use_model_download";
import { MODEL_CATALOGUE, type ModelSpec } from "@/lib/ai/catalogue";
import { AI_DISCLAIMER_STORAGE_KEY } from "@/lib/ai/disclaimer";
import { createDownloader, type DownloadState } from "@/lib/ai/downloader";
import { runFixtureTool } from "@/lib/ai/eval/fixture_tools";
import { configureAiEval } from "@/lib/ai/eval/harness";
import { readResidentBytes } from "@/lib/ai/eval/resident_memory";
import { createProductionDeps } from "@/lib/ai/model_files";
import { configureSession } from "@/lib/ai/session";
import { TOOL_REGISTRY } from "@/lib/ai/tools/registry";
import { unavailable, type ToolResult } from "@/lib/ai/tools/types";
import { llamaBridge } from "@/modules/llama_bridge";
import type { LoadOptions } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

const ChevronGlyph = registerIcon(ChevronRight);

/**
 * Spec §4.9's "once at first use". AsyncStorage rather than `app_settings`,
 * for the same reason the theme preference is (contexts/theme_context.tsx): it
 * is a UI acknowledgement, not ledger data, and it must be readable before the
 * database is unlocked — the disclaimer is shown on a screen a locked user can
 * still open.
 *
 * MOVED TO `lib/ai/disclaimer.ts` and re-exported here, so that
 * `lib/privacy/data_wipe.ts` can clear it on a start-over without importing a
 * route file. Assistant plan Task 25.
 */
export { AI_DISCLAIMER_STORAGE_KEY } from "@/lib/ai/disclaimer";

/**
 * `Device.totalMemory` is the single call `expo-device` was added for, and
 * `ram_gate.ts` fails closed on a null reading — a phone that cannot report its
 * memory is offered nothing rather than everything.
 */
function readTotalRam(): number {
  return Device.totalMemory ?? 0;
}

/**
 * The registry lookup, wrapped so an unknown name is a REFUSAL rather than a
 * throw. `dispatch.ts` would convert the throw into the same refusal, but doing
 * it here keeps the stack trace of a genuine handler crash distinguishable from
 * a model inventing a tool that does not exist.
 */
async function runTool(
  name: string,
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<unknown>> {
  const entry = TOOL_REGISTRY[name];
  if (entry === undefined) return unavailable(name, "That information could not be read just now.");
  return entry.handler(args, now);
}

/**
 * The largest downloaded model wins, catalogue order being ascending.
 *
 * A user who chose to spend the extra gigabytes meant to use them, and only one
 * model may be resident at a time (`llama_bridge/types.ts`). This is a default,
 * not a preference: when a persisted "active model" choice exists it belongs
 * here instead of this rule.
 */
function residentCandidate(states: Record<string, DownloadState>): ModelSpec | undefined {
  return [...MODEL_CATALOGUE]
    .reverse()
    .find((spec) => states[spec.id] === "ready" || states[spec.id] === "active");
}

export default function AiAssistantScreen() {
  const router = useRouter();
  const downloader = useMemo(() => createDownloader(createProductionDeps()), []);

  const [phase, setPhase] = useState<SurfacePhase>("waking");
  const [states, setStates] = useState<Record<string, DownloadState>>({});
  // Defaults to acknowledged so the disclaimer cannot flash on screen and then
  // vanish once AsyncStorage answers. A disclosure that appears for one frame
  // has not been made.
  const [disclaimerAcknowledged, setDisclaimerAcknowledged] = useState(true);

  useEffect(() => {
    void AsyncStorage.getItem(AI_DISCLAIMER_STORAGE_KEY).then((seen) => {
      setDisclaimerAcknowledged(seen === "1");
    });
  }, []);

  const acknowledgeDisclaimer = useCallback(() => {
    setDisclaimerAcknowledged(true);
    void AsyncStorage.setItem(AI_DISCLAIMER_STORAGE_KEY, "1");
  }, []);

  const refresh = useCallback(async () => {
    const next: Record<string, DownloadState> = {};
    for (const spec of MODEL_CATALOGUE) {
      next[spec.id] = await downloader.stateOf(spec);
    }
    setStates(next);

    // The weights survive a `resetContext()` on lock — that is the whole point
    // of spec §4.5's distinction — so a still-loaded bridge is re-entry, not a
    // reload, and must not be shown a "waking up" screen it does not need. The
    // eval harness registered by that load still stands.
    if (llamaBridge.isLoaded()) {
      setPhase("ready");
      return;
    }

    // Every road to the picker clears the eval's harness as well, so the eval
    // screen never offers to measure a model that is not loaded.
    const showPicker = () => {
      configureAiEval(null);
      setPhase("no_model");
    };

    const resident = residentCandidate(next);
    if (resident === undefined) {
      showPicker();
      return;
    }

    setPhase("waking");
    const path = await downloader.loadCandidatePath(resident);
    if (path === null) {
      showPicker();
      return;
    }

    const options: LoadOptions = {
      contextTokens: resident.contextTokens,
      suppressThinking: resident.suppressThinking,
    };
    try {
      await llamaBridge.load(path, options);
      // The session learns about the bridge here rather than at app start,
      // because a user who has never downloaded a model has no bridge to hand
      // it and must still lock cleanly (see session.ts).
      configureSession({ bridge: llamaBridge });
      // The eval measures this same resident model, and answers its tool
      // calls from the fixture ledger, never from this user's.
      configureAiEval({
        bridge: llamaBridge,
        runTool: runFixtureTool,
        readResidentBytes,
        model: { id: resident.id, path, options },
      });
      setPhase("ready");
    } catch {
      // The file is on disk but will not load. The picker is the recovery: it
      // is where the model can be deleted and downloaded again.
      showPicker();
    }
  }, [downloader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { transfers, download: handleDownload } = useModelDownload(downloader, refresh);

  const handleDelete = useCallback(
    async (spec: ModelSpec) => {
      await downloader.remove(spec);
      await refresh();
    },
    [downloader, refresh],
  );

  return (
    <View testID="ai-assistant-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      <Text className="px-4 pb-2 pt-4 text-title font-semibold text-fg dark:text-fg-dark">
        Assistant
      </Text>
      {/* Only a loaded model can be measured, so the way to the eval arrives
          with the chat and never with the picker. */}
      {phase === "ready" ? (
        <ListRow
          testID="ai-eval-entry"
          title="Test it on this phone"
          subtitle="30 practice questions. Your own transactions are never read."
          subtitleLines={3}
          right={<ChevronGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />}
          onPress={() => router.push("/more/ai/eval")}
        />
      ) : null}
      <ChatSurface
        phase={phase}
        picker={
          <ModelPicker
            readTotalRam={readTotalRam}
            states={states}
            progress={transfers}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        }
        bridge={phase === "no_model" ? null : llamaBridge}
        runTool={runTool}
        now={() => Date.now()}
        disclaimerAcknowledged={disclaimerAcknowledged}
        onAcknowledgeDisclaimer={acknowledgeDisclaimer}
      />
    </View>
  );
}
