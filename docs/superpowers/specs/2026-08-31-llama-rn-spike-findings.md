# llama.rn Spike Findings

**Device:** Samsung A54 5G, `SM-A546E`, **8 GB variant** (`MemTotal` 7,615,620 kB = 7.26 GiB).
Exynos 1380 (`s5e8835`), 8 cores, `arm64-v8a`, Android 16 / API 36.
**Dates run:** 2026-08-31.
**Spec this answers:** `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` §7.1.
**Licence check:** lives in `docs/superpowers/specs/2026-08-31-model-hosting-decision.md` §0, so that
one file answers "may we ship this, and where does it come from".

**Build under test:** Expo SDK 54.0.36 / RN 0.81.5 / React 19.1.0, pinned to match
`mobile/package.json` exactly. `llama.rn` **0.12.9** (last stable; the `latest` tag is a release
candidate). Debug dev-client APK, `arm64-v8a` only, `com.filldev.llamaprobe`.

---

## Conditions, stated up front because they qualify every number below

**The phone was on USB and charging at 99% for this run.** The spike's own global constraints require
every timing figure to be taken off charge, screen on, at stable ambient temperature, after a cold
start. **These runs satisfy none of that.** They are therefore reported as *functional* answers and as
*optimistic* timing bounds, and the tok/s figures must be retaken on battery before any tier is cut.

Runs were 64 tokens each, three consecutive, no cold start between them.

---

## Question 1: does `llama.rn` load a Qwen3 GGUF and stream tokens? — **YES**

Model: `qwen3-1.7b-q4` (tier 2), the middle of the menu, exactly as §7.1 directs. Loaded from app
private storage at `/data/user/0/com.filldev.llamaprobe/files/models/`, not from external storage.

| Run | TTFT | Tokens | Wall | Decode rate |
|---|---|---|---|---|
| 1 | 295 ms | 64 | 5,141 ms | 13.21 tok/s |
| 2 | 98 ms | 64 | 5,105 ms | 12.78 tok/s |
| 3 | 90 ms | 64 | 5,120 ms | 12.72 tok/s |

**Mean 12.90 tok/s, spread 0.48 tok/s (3.7%).** Model load: **4,901 ms** for the 1.1 GB file.

**Noise floor is small.** §5.5 requires one before a tier can be cut, and 3.7% across three runs is
tight enough that a tier-to-tier difference larger than roughly 1 tok/s is real rather than jitter.

### This contradicts the 2026-08-21 amendment, and the amendment loses

Spec §2.1 estimated tier 2 at **12–20 tok/s**. Measured **12.90**: inside the band, at the low end.

The amendment added on 2026-08-21 said, from a Termux CLI measurement of tier 1, to *"treat every
remaining tok/s cell as optimistic by the same factor until measured"*, scaling tier 2 down to
roughly 4–6.7 tok/s. **That scaling is now measured and wrong.** Do not carry it forward.

Worse for the old reading: that amendment measured the **0.6B** at 7.5–10.8 tok/s, and this run has
the **1.7B**, nearly three times larger, running *faster* at 12.9. A bigger model cannot genuinely be
quicker on the same silicon, so one of the two measurements is not measuring what it claims.
Candidate explanations, none yet settled:

- The Termux run used llama.cpp build b10553 generically compiled; `llama.rn` ships **CPU-dispatch
  variants** and will have selected the `dotprod` path for this Cortex-A78 (see question 6).
- This run was on charge with a full battery and no thermal history. The Termux run's conditions were
  not recorded.
- 64 tokens is short. Sustained generation may throttle in a way a 5-second burst does not.

**Consequence:** the tier-1 Termux figure should be re-taken inside this app before either number is
used to size anything. Two measurements taken by different tools under different conditions are not
comparable, and §4.4's latency budget should not be rebuilt on the older one.

### The thinking tokens are the real finding here

**All three runs spent their entire 64-token budget inside `<think>` and never emitted a single word
of user-visible answer.** Sample, run 3:

```
<think>
Okay, the user wants a short sentence about saving money. Let me think. They specified exactly
one sentence, so I need to be concise. The key points are saving money and the benefit. Maybe
something like, "Prioritize budgeting to allocate funds towards essential needs and long-term
goals." That covers both
```

Thinking was deliberately left **on** for this task; suppression is question 3's job. But this is an
early, unambiguous confirmation of why §2.1 makes `suppressThinking` per-model data and why §5.6
makes it an on-device gate rather than a unit test: **at 12.9 tok/s, an unsuppressed tier-2 model
burns more than five seconds before the user sees anything at all.** If suppression silently fails in
production, the tokens are still decoded and still paid for in latency, and the surface looks hung.

---

## Question 5 (tier 2): strict tool-pick accuracy — **97%, far above the ~70% bar**

The question §7.3 row 2 gates the whole chat surface on. Tier 2 (`qwen3-1.7b-q4`), the 12-question
cut-down of §5.5's 30, three passes, 36 generations:

| Pass | Strict | `name_correct` | Failed |
|---|---|---|---|
| 1 | 11/12 (92%) | **12/12** | q08 |
| 2 | 12/12 (100%) | 12/12 | — |
| 3 | 12/12 (100%) | 12/12 | — |
| **Mean** | **35/36 = 97%** | **36/36** | |

**Tool selection was perfect: 36 out of 36.** That includes both Taglish questions, both two-tool
questions, and — importantly — **both out-of-scope questions, where naming any tool at all is a
failure.** The over-eager-tool-use failure mode §5.5 worried about did not appear once.

### The single miss is a period-extraction bug in Taglish, not a tool-selection one

**q08: *"nung nakaraang buwan, saan napunta ang pera ko?"*** — expected
`get_spend_by_category / last_month`. The model chose the right tool and the wrong period.
"nung nakaraang buwan" is *last month*.

This is precisely why §5.5 forbids partial credit: right tool with the wrong period is a wrong answer
to the user, and it is the difference between showing them August and showing them July. It is also
why the scorer keeps `name_correct` and `args_correct` as separate counters — a period-extraction
problem is prompt work on temporal phrases, while a tool-selection problem would have been a far
deeper worry. This is the shallow one.

**It is also flaky rather than systematic: q08 failed once in three passes and passed twice.** That
matters for how it gets fixed. A deterministic failure would be a prompt bug; an intermittent one at
non-zero temperature is a sampling margin, and the fix is either a clearer temporal instruction in the
prompt or a lower temperature for the tool-selection round. Both belong to Task 10, not here.

### What this does and does not license

**Does:** tier 2 comfortably clears §7.3 row 2's ~70% bar, so on this evidence the feature ships as a
chat surface rather than the §7.4 fallback — *for anyone who can run tier 2*.

**Does not:**
- **Tier 1 is unmeasured, and tier 1 is the whole free-tier question** (§6 risks 1 and 7). At ~0.4 GB
  it is the only tier casually downloadable on Philippine prepaid data, and a 0.6B has far less
  headroom for exactly the argument-extraction the one failure here landed on.
- This is the **12-question cut-down**, not §5.5's 30, and the advice questions are excluded because
  `triage.ts` does not exist.
- The system prompt is **hand-written for this spike**, not the production prompt from Task 10. A
  different prompt scores differently; this measures the model's capability, not the shipped system.
- **Run unconstrained**, deliberately, so the number reflects the model's choice rather than a
  grammar's compulsion (see question 2).
- On charge, like every other timing figure here. Per-question latency was 3.1–4.8 s, slower than the
  1.4 s single-tool case because the five-tool system prompt is longer to prefill.

---

## Question 2: does llama.cpp accept a per-request GBNF, and does it hold? — **YES to both, and the grammar *design* in §3.4 does not survive**

**Accepted as a per-request option:** yes. Option key `grammar`, passed on `completion()` alongside
`messages` and `jinja`.
**Changing the grammar between two calls on the SAME context takes effect:** **yes**, proven below.
**Passing `null` returns to unconstrained:** yes.
**Does constrained decoding hold?** **Yes — 0 malformed in 50 generations** against the tool grammar.

### The runtime is fine. The rules were not.

The per-request assertion is the one Task 5 step 3 warns is easy to skip, and the first attempt at it
was inconclusive: both grammars produced prose because the model never took the tool-call branch at
all (0 tool calls in 50 runs, with no system prompt — the grammar *permits* a tool call, nothing
*induces* one). Adding a system prompt that induces one made the test discriminating.

Four grammars, same context, same prompt, three runs each:

| Grammar | `{` | `[` | `\r` | Result |
|---|---|---|---|---|
| tool grammar (positive) | yes | — | — | **3/3 exact tool calls**, 1.4–2.7 s |
| `[^{] [^\n]*` (spec §3.4's) | **yes 3/3** | no | no | tool call via `({...})`, ` {...}`, ` ```json{...}``` ` |
| `[^{\n]+` | no 3/3 | — | **yes 3/3** | 64 tokens of carriage returns, 6.2–6.8 s |
| `[a-zA-Z0-9 ,.'!?%$-]+` | no 3/3 | no 3/3 | no 3/3 | 64 tokens of garbage, 5.6–6.3 s |
| none | yes | — | — | 3/3 exact tool calls, 1.4 s |

**The presence of each forbidden character tracked the active grammar exactly, call by call, on one
context. That is the per-request answer, and it is unambiguous.**

### What the three prose grammars actually did

**1. The spec's rule forbids `{` only at position 0.** `[^{]` is a single character; `[^\n]*` then
permits `{` freely. The model emitted a complete, valid tool call three times out of three by
prefixing `(`, a space, or a ```` ```json ```` fence. One of those — the leading space — **parses as a
valid tool call after trimming**.

**2. Excluding the brace moved the problem, twice.** `[^{\n]+` removed `{`, and the model emitted a
bracket-style call instead (`["get_spend_by_category", "args": ["this_month"]]`). It also never
excluded `\r`, so runs degenerated into sixty-plus carriage returns at 6.2–6.8 s against 1.4 s for a
real answer.

**3. The strict positive class removed every escape and produced garbage, not prose.** All three runs
hit the 64-token cap with nonsense, two of them base64:

```
eyJzIjoiNjVhYWMxYi0yNjVhLWRlMjMtYmFhYi0xYmQ0LWM3MDA6NjVhYWMxYiIsInJlZiI6IjE
  → {"s":"65aac1b-265a-de23-baab-1bd4-c700:65aac1b","ref":"1
```

**Read that carefully and do not anthropomorphise it.** The model is not cleverly smuggling JSON past
a filter. Base64's alphabet is alphanumeric, which is all the grammar permitted, so when every token
the model actually wanted was masked it fell into a degenerate region of a mangled distribution and
the surviving tokens happened to spell base64. The mechanism is boring. **The consequence is not.**

### The finding that reshapes §3.4

**GBNF is excellent at compelling a format and useless at forbidding one.**

The positive tool grammar is flawless: 3/3 exact calls, 0/50 malformed, 1.4–2.7 s. Every attempt to
express *"anything except a tool call"* failed, and each fix only revealed the next escape — brace,
then bracket, then carriage return, then a degenerate alphabet. A negated character class forbids
only what its author thought of, and the author is competing against a decoder that will happily take
any surviving path.

**So §3.4's forced-answer round cannot be implemented as a restrictive grammar.** When the model's
intended output is masked it does not gracefully fall back to prose; it emits garbage, slowly. The
options are:

1. **Run the forced round with no grammar and have the dispatcher refuse to act on a tool call in
   that round.** Simplest, robust, and it costs nothing: unconstrained generation with a good system
   prompt answered correctly in 1.4 s. **Recommended.**
2. Write a genuine sentence grammar. Far harder than a character class, and everything above says the
   first three attempts at it will be wrong.

**Consequence for implementation plan Task 11 (JSON Schema → GBNF):** the generator only ever needs to
emit *positive* grammars describing a target shape, which is exactly what it was scoped to do. It must
**not** grow a "prose branch" that tries to describe the complement. The `prose ::= [^{] [^\n]*`
alternative in the spec's own fixture is the bug this spike was written to find.

**Consequence for `dispatch.ts`:** parse the **raw** model output, not a trimmed copy. A leading space
in front of a tool call is invisible after `.trim()` and turns a forbidden round into a dispatched one.

All four grammars are kept in `lib/grammar_fixture.ts`, the broken ones included, so each failure
stays reproducible for whoever writes `lib/ai/tools/grammar.ts`.

### Incidental, and it matters for question 5

**With a system prompt and no grammar at all, tier 2 emitted the exact expected tool call every
time** — right tool name, right enum, no surrounding prose, 1.4–1.5 s. That is an encouraging early
read on tool-pick, though it is one hand-written prompt against one tool and is not a substitute for
the scored 12-question eval.

---

## Question 3: can thinking be suppressed, and what does it cost? — **YES, and it is the single largest latency win available**

**Lever found:** the chat template's own flag, not a prompt hack. `llama.rn` accepts
`messages` + `jinja: true` + **`enable_thinking: false`** on `completion()`, and also exposes
`thinking_budget_tokens`, `thinking_forced_open` and `reasoning_format` for finer control. Preference
1 in Task 6 step 1 was available, so the stream-level stripper stays what the spec called it:
belt-and-braces, never the mechanism.

Tier 2, three runs per config, `n_predict` 128, identical prompt:

| Config | median TTFT | median wall | median tokens | `<think>` visible? |
|---|---|---|---|---|
| unsuppressed | 115 ms | **11,086 ms** | 128 (hit the cap) | yes |
| template-suppressed | 111 ms | **739 ms** | **7** | no |
| stripper only | 108 ms | 10,504 ms | 128 (hit the cap) | yes, removed after the fact |

**Did suppression measurably change the clock? Yes — by 15x.** 739 ms against 11,086 ms.

### Three things this run settles

**1. Suppression is real, and §7.3's last row does not fire.** The feared outcome was that tiers 1–3
pay an unavoidable latency tax and the menu collapses to the two 2507 tiers, which would have
contradicted §0.3's free-for-everyone goal. That does not happen. The hybrid tiers can be made to
answer immediately.

**2. Unsuppressed, tier 2 never produced an answer at all.** Every unsuppressed run spent all 128
tokens inside `<think>` and hit the cap mid-thought. Not "slow" — *absent*. Meanwhile the suppressed
runs answered in 7 tokens: *"Save money by avoiding unnecessary purchases."* Coherent, one sentence,
under three quarters of a second.

**3. The stripper failure mode is worse than the spec predicted, and the run proves it.** The
stripper config was included precisely to demonstrate clean output with an unchanged bill, and it
did — 10,504 ms against the unsuppressed 11,086 ms, within noise. But look at what the user would
have seen:

```
"visible_text": ""
```

**Empty.** Because the `<think>` block never closed inside the budget, stripping it removed the
entire output. So a stripper-only fallback does not merely fail to save time; it can hand the user a
blank message after eleven seconds. If `enable_thinking` ever silently stops working in production
and the stripper is all that stands behind it, the symptom is not a slow answer, it is **no answer**.
Spec §5.6 gate 3 should be worded to fail on an empty answer, not only on a visible tag.

### A methodological note for whoever repeats this

**TTFT is not a discriminator here and must not be used as one.** It sat at 108–115 ms across all
three configs, because prefill is identical no matter what the model does afterwards. Only wall clock
separates them. A gate written against TTFT would have passed the stripper-only config.

**Nor does suppression speed up decoding.** Decode rate was ~12 tok/s in every config. Suppression
wins by not generating 120 tokens nobody asked for. The user feels wall clock; the tok/s figure is
unchanged and would have hidden the entire effect.

---

## Question 4 (partial): peak memory, and the tier ceiling moves again

`dumpsys meminfo com.filldev.llamaprobe` with tier 2 resident at `n_ctx` 2048:

| Metric | Value |
|---|---|
| **TOTAL PSS** | 2,669,622 kB = **2.55 GB** |
| TOTAL RSS | 2,696,941 kB = 2.57 GB |
| Native heap (dirty) | 1,425,824 kB = 1.36 GB |
| Clean | 1,104,568 kB = 1.05 GB |
| Swap PSS | 57,709 kB |

**A 1.1 GB model costs 2.55 GB of PSS.** Roughly 2.3x the weight file, which is the ratio §2.2 warned
about when it insisted `minRamBytes` is not the file size.

**This moves the practical ceiling down from tier 3 to tier 2.** The 2026-08-21 reading put the
ceiling at tier 3 on RAM-variant grounds. But measured available memory on this phone was 2.66 GiB
(2026-08-31, with 3.4 GB already in zram at idle), and tier 2 alone now occupies 2.55 GB. Tier 3's
weights are 1.8 GB against tier 2's 1.1 GB; at anything like the same ratio it does not fit, and
tiers 4 and 5 are not close.

**Held loosely, for two reasons.** This is a **debug dev-client** build carrying Hermes in dev mode
and a Metro-served bundle in memory, so a release build will be leaner by an unmeasured amount. And
it is one sample. Task 7 still owes repeated sampling and a release-build comparison before
`minRamBytes` is derived from anything here.

---

## Question 6 (partial): APK delta

`llama.rn` 0.12.9 ships **fourteen CPU-dispatch variants** of its native library plus JNI shims and
Hexagon assets: **eighteen files, 75.4 MB, `arm64-v8a` alone**, stored uncompressed in the APK
(`unzip -v` reports compressed size equal to uncompressed), so it does not shrink in transit. Whole
debug APK: 133,320,801 bytes.

**Spec §7.3 triggers a Play Feature Delivery review at a ~40 MB delta. This is roughly 1.9x that**,
on the arm64-only build the constraints already required.

A baseline build without `llama.rn` has not been made, so 75.4 MB is a **floor on the delta**, not the
delta. Mitigation to evaluate before concluding: the `i8mm` variants (~21 MB) and the
`hexagon_opencl` variant (~13 MB) cannot execute on this Exynos 1380 at all. Excluding them saves
~34 MB but narrows device support, which is a product decision rather than a gradle tweak.

---

## Risk 8 (partial): SHA-256 over a multi-gigabyte file

`sha256sum` on-device over the 1.1 GB tier-2 file: **2.29 s real** (0.72 user, 1.03 system), roughly
484 MB/s, digest matching the PC byte for byte.

**This does not close risk 8.** The risk is specifically about `@noble/hashes` **in JavaScript** over
`expo-file-system/legacy`. The 2.29 s figure is native C with ARMv8 crypto extensions and is properly
read as: *the hardware is nowhere near the bottleneck, so if the JS path proves too slow, a native
helper is clearly viable.* The JS measurement is still owed.

---

## Method notes, for whoever runs this next

**The probe runs on mount and logs to logcat**, rather than being driven by buttons as the plan
describes. Every measurement is emitted as a single `PROBE_JSON` line and read with `adb logcat`. A
spike whose numbers require a human to sit and tap is a spike that gets run once; §5.5 wants three
runs of everything.

Three things cost time and are worth knowing in advance:

1. `create-expo-app` scaffolds **SDK 57 / RN 0.86.3** now. `mobile/` is on SDK 54 / RN 0.81.5, and
   `llama.rn` is a JSI library, so the spike must be pinned down or it measures the wrong runtime.
2. `npm install llama.rn` **fails under Git Bash on Windows** — its postinstall's MSYS `tar` reads the
   Windows path as a remote host (`Cannot connect to C: resolve failed`). Install from PowerShell.
3. `app.json` has no `scheme`, so the `expo-development-client` deep link will not resolve, and the
   dev launcher's URL box shows `http://localhost:8081` as **placeholder** text — pressing Connect
   without typing submits an empty host and fails with `Invalid URL host: ""`. Either add a scheme
   and rebuild, or drive it with `adb shell input`.

---

## Still open

| Question | Status |
|---|---|
| 1. Loads and streams | **Answered: yes**, tier 2, 12.90 tok/s mean |
| 2. Per-request GBNF | **Answered: yes**, per request and 0/50 malformed — but §3.4's grammar design fails |
| 3. Thinking suppression | **Answered: yes**, `enable_thinking: false` under jinja, 15x on wall clock |
| 4. Peak RSS + app-switch survival | **partial**, one sample, debug build, no app-switch test |
| 5. Strict tool-pick accuracy | **Tier 2 answered: 97%**, 36/36 on tool name. Tier 1 still unmeasured |
| 6. APK delta | **partial**, floor of 75.4 MB, no baseline build |
| 7. `Device.totalMemory` truthfulness | not started |

**All timing figures above were taken on charge and must be retaken on battery.**
