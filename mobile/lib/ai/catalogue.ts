// mobile/lib/ai/catalogue.ts
//
// DATA, COMPILED INTO THE BINARY. The catalogue never comes off the network.
// `docs/superpowers/specs/2026-08-31-model-hosting-decision.md` §3: if a served
// catalogue and this file ever disagree about a digest, THIS FILE WINS, always.
// The server has no path to override a hash, because a server that can hand the
// device a hash can hand the device any weights it likes.
//
// TWO TIERS, NOT FIVE. The owner cut tiers 3-5 on 2026-08-31: `qwen3-1.7b-q8`
// by decision, `qwen3-4b-2507-q4` because it will not load on any hardware we
// have, `qwen3-4b-2507-q6` because it failed to load on the A54. Their pinned
// URLs and revisions survive in the decision doc §2, so reinstating one is a
// catalogue edit plus a `sha256sum` rather than a new investigation.
//
// EVERY LITERAL HERE WAS READ, NOT ESTIMATED. Digests were computed twice, once
// on the PC and once on the device; byte counts match the Hugging Face API blob
// size AND the HTTP `Content-Length` from a HEAD request against the same
// pinned URL. Three independent readings of the same number, so `bytes` is not
// a transcription.

/**
 * Spec §2.1's shape, unchanged.
 *
 * `id` is stable FOREVER — it is the on-disk filename (§2.3). Renaming one
 * orphans a downloaded model on every device that already holds it.
 */
export type ModelSpec = {
  id: string;
  displayName: string;
  params: string;
  quant: string;
  bytes: number;
  /** 64 lowercase hex. Verified on the PC and again on the device. */
  sha256: string;
  /** https only, pinned to an immutable `resolve/<commit-sha>/` revision. */
  url: string;
  /** Headroom-adjusted TOTAL device RAM, always > `bytes` (§2.2). */
  minRamBytes: number;
  contextTokens: number;
  suppressThinking: boolean;
  /**
   * The month the model was released, named by the level-5 notice as the point
   * its knowledge stops. Qwen publishes no training cutoff for Qwen3, and no
   * training data can postdate the release. Assistant levels spec §5.3.
   */
  knowledgeLimit: string;
  /**
   * Whether the model can run free chat (answer levels 3 to 5). The 0.6B cannot:
   * on the phone it ignored questions and repeated itself (docs/13, "Run
   * 2026-09-26"). Chips and typed asks work on every model.
   */
  freeChat: boolean;
  license: string;
};

/**
 * The context length every measurement in the spike was taken at.
 *
 * IT IS NOT A FREE PARAMETER. `minRamBytes` below is derived from PSS readings
 * taken at `n_ctx` 2048; the KV cache grows with this number, so raising it
 * invalidates both entries' RAM gates and the gate is what stops Android
 * killing the app mid-answer. Changing it means re-measuring, not re-typing.
 */
const CONTEXT_TOKENS = 2048;

const GIB = 1024 * 1024 * 1024;

export const MODEL_CATALOGUE: readonly ModelSpec[] = [
  {
    id: "qwen3-0.6b-q4",
    displayName: "Qwen3 0.6B",
    params: "0.6B",
    quant: "Q4_K_M",
    bytes: 396705472,
    sha256: "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a",
    url: "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf",
    // MEASURED 1.25 GB TOTAL PSS on the A54 at n_ctx 2048 (spike question 4),
    // which is 3.3x the 378 MB file — most of it fixed cost, not weights.
    // Gated at 3.5 GiB of TOTAL RAM: a nominal 4 GB phone reports about
    // 3.6 GiB, so 4 GB devices qualify and 3 GB devices do not. The headroom is
    // deliberately wide because the PSS reading came from a DEBUG dev-client
    // build and is an upper bound by an unmeasured amount.
    minRamBytes: Math.round(3.5 * GIB),
    contextTokens: CONTEXT_TOKENS,
    // Hybrid-thinking Qwen3: emits <think>…</think> unless suppressed.
    suppressThinking: true,
    // Hugging Face's API: Qwen/Qwen3-0.6B created 2025-04-27.
    knowledgeLimit: "April 2025",
    // On the phone it ignored questions and repeated itself in free chat
    // (docs/13, "Run 2026-09-26"). Its chip answers were fine.
    freeChat: false,
    license: "apache-2.0",
  },
  {
    id: "qwen3-1.7b-q4",
    displayName: "Qwen3 1.7B",
    params: "1.7B",
    quant: "Q4_K_M",
    bytes: 1107409472,
    sha256: "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897",
    url: "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf",
    // MEASURED 2.51 GB TOTAL PSS at n_ctx 2048, replicated at 2.55 GB in an
    // earlier session — two readings within 2%. On the 8 GB A54 that is
    // 2.51 GB against 2.66 GiB available, which the spike called "genuinely at
    // the edge". A 6 GB phone has roughly 2 GiB available and would be killed,
    // so the gate is 6.5 GiB of TOTAL RAM: 8 GB devices qualify (the A54
    // reports 7.263 GiB), 6 GB devices do not. Spec §2.1 anticipated exactly
    // this collapse of the menu to tier 1 on half the devices; it is the honest
    // outcome, not a conservative guess.
    minRamBytes: Math.round(6.5 * GIB),
    contextTokens: CONTEXT_TOKENS,
    suppressThinking: true,
    // Hugging Face's API: Qwen/Qwen3-1.7B created 2025-04-27.
    knowledgeLimit: "April 2025",
    freeChat: true,
    license: "apache-2.0",
  },
];
