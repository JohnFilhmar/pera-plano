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

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { DownloaderDeps } from "@/lib/ai/downloader";
import { runFixtureTool } from "@/lib/ai/eval/fixture_tools";
import { configureAiEval, currentAiEval } from "@/lib/ai/eval/harness";
import { readResidentBytes } from "@/lib/ai/eval/resident_memory";
import { FIXED_QUESTIONS } from "@/lib/ai/fixed_questions";
import { AI_ANSWER_LEVEL_STORAGE_KEY, AI_LEVELS_ACCEPTED_STORAGE_KEY } from "@/lib/ai/levels";
import { __setTierForTests } from "@/lib/entitlements";
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
      sha256: async () => "",
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
  // The count is typed into the row, so a new question has to update it.
  screen.getByText(`${FIXED_QUESTIONS.length} practice questions. Your own transactions are never read.`);
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

// Found on the A54, 2026-09-25: the keyboard covered the composer and the
// chips, because edge-to-edge Android no longer resizes the window for it. The
// offset is the part that fails quietly. The avoiding view measures itself from
// its parent, and the tab navigator starts every screen `insets.top` below the
// window's top, so an offset of 0 leaves the composer that far under the keys.
test("the screen lifts the composer above the keyboard, offset by the tab navigator's top inset", async () => {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 24, bottom: 48, left: 0, right: 0 },
      }}
    >
      <AiAssistantScreen />
    </SafeAreaProvider>,
  );
  await screen.findByTestId("ai-eval-entry");

  const root = screen.getByTestId("ai-assistant-screen");
  expect(root.props.behavior).toBe("padding");
  expect(root.props.keyboardVerticalOffset).toBe(24);
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

describe("the answer level (assistant levels spec §6)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    __setTierForTests(null);
  });

  test("starts at level 2", async () => {
    render(<AiAssistantScreen />);
    expect(await screen.findByTestId("ai-level-entry")).toHaveTextContent(/Level 2 · Typed asks/);
  });

  test("a chosen level is kept", async () => {
    render(<AiAssistantScreen />);
    fireEvent.press(await screen.findByTestId("ai-level-entry"));
    fireEvent.press(screen.getByTestId("ai-level-3"));

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(AI_ANSWER_LEVEL_STORAGE_KEY)).toBe("3");
    });
    expect(screen.getByTestId("ai-level-entry")).toHaveTextContent(/Level 3 · Chat/);
  });

  test("level 5 asks for acceptance first, and remembers it", async () => {
    render(<AiAssistantScreen />);
    fireEvent.press(await screen.findByTestId("ai-level-entry"));
    fireEvent.press(screen.getByTestId("ai-level-5"));
    fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(AI_LEVELS_ACCEPTED_STORAGE_KEY)).toBe("1");
    });
    expect(await AsyncStorage.getItem(AI_ANSWER_LEVEL_STORAGE_KEY)).toBe("5");
  });

  test("a stored level 5 runs as level 3 on the free tier, and stays stored", async () => {
    __setTierForTests("free");
    await AsyncStorage.setItem(AI_ANSWER_LEVEL_STORAGE_KEY, "5");

    render(<AiAssistantScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("ai-level-entry")).toHaveTextContent(/Level 3 · Chat/);
    });
    expect(await AsyncStorage.getItem(AI_ANSWER_LEVEL_STORAGE_KEY)).toBe("5");
  });
});
