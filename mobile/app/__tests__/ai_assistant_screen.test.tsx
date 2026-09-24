// app/__tests__/ai_assistant_screen.test.tsx
//
// THE ASSISTANT SCREEN IS WHAT MAKES THE EVAL RUNNABLE. Loading a model must
// register the eval harness against that model and the fixture ledger, a model
// that will not load must clear it, and the way to the eval appears only with
// the chat. `llama.rn` is mapped to test_support/llama_rn_mock.ts, so the real
// bridge module runs here against a fake runtime.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

jest.mock("expo-device", () => ({ totalMemory: 8 * 1024 ** 3 }));

jest.mock("@/lib/ai/model_files", () => ({
  createProductionDeps: () => mockDeps,
}));

import { fireEvent, render, screen } from "@testing-library/react-native";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { DownloaderDeps } from "@/lib/ai/downloader";
import { runFixtureTool } from "@/lib/ai/eval/fixture_tools";
import { configureAiEval, currentAiEval } from "@/lib/ai/eval/harness";
import { readResidentBytes } from "@/lib/ai/eval/resident_memory";
import { llamaBridge } from "@/modules/llama_bridge";

import AiAssistantScreen from "../(tabs)/more/ai";

const mockPush = jest.fn();
let mockDeps: DownloaderDeps;

const TIER_ONE = MODEL_CATALOGUE[0];
const MODELS_DIR = "file:///models/";
const MODEL_PATH = `${MODELS_DIR}${TIER_ONE.id}.gguf`;

beforeEach(() => {
  mockPush.mockClear();
  // Tier 1 is verified on disk and nothing else is.
  mockDeps = {
    fetch: async () => {
      throw new Error("this suite never downloads");
    },
    files: {
      ensureDir: async () => undefined,
      exists: async (path) => path === MODEL_PATH,
      size: async () => TIER_ONE.bytes,
      append: async () => undefined,
      readChunks: async function* () {},
      remove: async () => undefined,
      rename: async () => undefined,
      freeSpace: async () => 50_000_000_000,
    },
    modelsDir: MODELS_DIR,
    isMetered: async () => false,
  };
});

afterEach(async () => {
  jest.restoreAllMocks();
  await llamaBridge.unload();
  configureAiEval(null);
});

test("a loaded model registers the eval on itself and the fixture ledger, and the row opens it", async () => {
  render(<AiAssistantScreen />);
  fireEvent.press(await screen.findByTestId("ai-eval-entry"));

  expect(mockPush).toHaveBeenCalledWith("/more/ai/eval");
  expect(currentAiEval()).toEqual({
    bridge: llamaBridge,
    runTool: runFixtureTool,
    readResidentBytes,
    model: {
      id: TIER_ONE.id,
      path: MODEL_PATH,
      options: {
        contextTokens: TIER_ONE.contextTokens,
        suppressThinking: TIER_ONE.suppressThinking,
      },
    },
  });
});

test("re-entry with the model still loaded keeps the registration its load made", async () => {
  const load = jest.spyOn(llamaBridge, "load");
  const first = render(<AiAssistantScreen />);
  await screen.findByTestId("ai-eval-entry");
  const registered = currentAiEval();
  first.unmount();

  render(<AiAssistantScreen />);
  await screen.findByTestId("ai-eval-entry");

  expect(load).toHaveBeenCalledTimes(1);
  expect(currentAiEval()).toBe(registered);
});

test("a model that will not load clears the eval and offers no way to it", async () => {
  configureAiEval({
    bridge: llamaBridge,
    runTool: runFixtureTool,
    readResidentBytes,
    model: { id: "stale", path: "file:///gone.gguf", options: { contextTokens: 2048, suppressThinking: true } },
  });
  jest.spyOn(llamaBridge, "load").mockRejectedValueOnce(new Error("not a gguf"));

  render(<AiAssistantScreen />);
  await screen.findByTestId("ai-no-model");

  expect(currentAiEval()).toBeNull();
  expect(screen.queryByTestId("ai-eval-entry")).toBeNull();
});
