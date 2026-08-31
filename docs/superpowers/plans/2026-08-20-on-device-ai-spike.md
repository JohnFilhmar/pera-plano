# On-Device AI Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the seven questions in spec §7.1 with measured numbers from the owner's Samsung A54 5G, so that the on-device assistant's implementation plan is written against hardware facts instead of extrapolations — and so that a disappointing answer routes to the named fallback design (§7.4) rather than to a cancellation.

**Architecture:** A throwaway Expo dev-client app on its own branch, in its own directory, with its own Android package id so it can sit on the phone next to PeraPlano. It adds `llama.rn` and nothing else PeraPlano-shaped: no database, no repos, no SQLCipher, no lock. One screen with a model picker, a prompt box, a grammar toggle, a stopwatch and a results log. **Nothing from this branch is ever merged.** The only artefact that survives is a findings document, hand-authored onto the mainline, which the implementation plan then reads.

**Tech Stack:** Expo SDK 54 · React Native 0.81.5 · TypeScript ~5.9 · `llama.rn` (the thing under test) · `expo-device` (question 7 only) · `expo-file-system/legacy` · Android arm64-only · `adb` for every measurement that a JS timer cannot see.

**Spec:** `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` — §7 in full, plus §2.1 (the tier table this spike is replacing the estimates in), §6 risks 1–2 and 7–8, and §7.4 (the fallback this plan must be able to route to).

**Follow-on plan:** `docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md` — every phase in it that is gated on a §7.1 question names the question. This plan produces the answers.

---

## What this spike is not

It is not a prototype of the assistant. It touches no PeraPlano code, reads no ledger, and shares no module with `mobile/`. If a step here starts to feel like "we may as well build the real thing while we're in here", that is the failure mode this plan exists to prevent: a spike that becomes the implementation is a spike whose findings were never written down, and the implementation plan is then written against a feeling instead of a number.

**Every task below ends by writing a number or a yes/no into the findings table in Task 12.** A task that produced no recorded value has not been done, however much code it produced.

---

## Global Constraints

- **Nothing in this plan is merged to `master` except the findings document.** The spike app lives on `spike/llama-rn-probe` and stays there. Deleting the branch after the findings land is the intended end state, not a loss.
- **`mobile/` is not modified by any task in this plan.** Not `package.json`, not `app.json`, not one file. The scope fence is the point: the MVP's critical path must not carry a native dependency that may be removed again next week (spec §0.4).
- **Android arm64 only.** `reactNativeArchitectures=arm64-v8a` in the spike's `android/gradle.properties`. This app is Android-only and modern; there is no 32-bit story to protect (spec §6, risk 3), and question 6's APK-delta number is meaningless if it includes three ABIs the product will never ship.
- **A distinct application id: `com.filldev.llamaprobe`.** PeraPlano's dev client is `com.filldev.peraplano.dev` (recorded in project memory). Reusing either id makes the phone replace one app with the other, and a measurement taken after the real app was uninstalled is not a measurement of the real device state.
- **`ninja` 1.13.0.** The Android SDK's bundled ninja 1.10.2 aborts local builds on this machine with a MAX_PATH failure (project memory: *Android ninja swap*). The same swap applies here; the spike is not a fresh diagnosis of a solved problem.
- **Every timing figure is recorded with the phone off charge, screen on, at a stable ambient temperature, and after a cold app start.** A tok/s taken while charging on a hot phone is a different number from the one a user gets, and the whole value of this spike is that its numbers are the user's.
- **Three runs minimum for any number that will be compared against another number.** §5.5 requires a noise floor before a tier can be cut; a spike that reports single-run figures hands the tier-cut decision a spread it cannot see.
- **Commits:** Conventional Commits, on the spike branch. **No AI-attribution trailer or footer of any kind.**
- **No `.env*`, no `*.enc`, no key material is read, copied, or created by any task here.** The spike has no secrets; if a step appears to need one, the step is wrong.

---

## Pre-flight: what was verified in the real codebase before this plan was written

These were checked against `mobile/` on 2026-08-20, not taken from the spec.

| Claim in the spec | Status |
|---|---|
| `llama.rn` is absent from `mobile/package.json` | **Confirmed.** Not in dependencies or devDependencies. |
| `expo-device` is absent | **Confirmed.** `expo-constants`, `expo-crypto`, `expo-file-system` etc. are present; `expo-device` is not. |
| `@noble/hashes` is already a dependency | **Confirmed**, `^2.3.0`, and already in `transformIgnorePatterns` so Jest can load it. |
| `expo-file-system/legacy` is the API the repo uses | **Confirmed** — `lib/privacy/data_export.ts:31` and `lib/reports/csv_export.ts:86`. |
| `mobile/app.json` does not set `android:allowBackup="false"` | **Confirmed.** The `android` block sets `package`, `adaptiveIcon`, `edgeToEdgeEnabled`, `permissions`, `blockedPermissions` — no backup flag. §2.3 rule 4's backup exclusion is genuinely required. |
| `modules/notification_listener/` is the structural precedent | **Confirmed**, with one correction: it has `index.ts`, `app.plugin.js`, `__tests__/`, `android/`, **and an `expo-module.config.json`**. `mobile/package.json` sets `expo.autolinking.nativeModulesDir: "./modules"`, so that config file is what makes it autolink. A `llama_bridge/` without one is not autolinked, which is exactly what spec §1.1 wants — but its `app.plugin.js` must then be listed explicitly in `app.json`'s `plugins` array, the way `"./modules/notification_listener/app.plugin.js"` already is. The spec does not say this and it is easy to miss. |

The remaining verification — the seven tool-handler bindings — belongs to the implementation plan and is recorded there.

---

## File Structure

**Created (spike branch only, never merged)**

| File | Responsibility |
|---|---|
| `spike/llama_probe/` | The whole throwaway app. One `create-expo-app` tree. |
| `spike/llama_probe/app/index.tsx` | The one screen: model picker, prompt box, grammar toggle, run button, results log. |
| `spike/llama_probe/lib/probe.ts` | Thin wrapper over `llama.rn` that records TTFT, token count, wall clock. No abstraction beyond what the measurements need. |
| `spike/llama_probe/lib/grammar_fixture.ts` | One hand-written GBNF for `get_spend_by_category` — hand-written, **not** generated, because question 2 is about llama.cpp's parser and a generator would put our own bug between us and the answer. |
| `spike/llama_probe/lib/eval_12.ts` | The 12-question cut-down set and its hardcoded fixture ledger, as data. |
| `spike/llama_probe/lib/score.ts` | Strict tool-pick scoring: first tool call, exact name, deep-equal args. |

**Created (mainline, the only thing that survives)**

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md` | The seven answers, the numbers, the go/reshape/fallback verdict, and the date. Task 12. |

**Modified (mainline)**

| File | Change |
|---|---|
| `docs/13-on-device-verification.md` | Task 1 and Task 12 append: the RAM-variant fact, and a pointer to the findings doc. |

---

## Task 1: Settle the A54 RAM variant — no spike required, and it goes first

> **RESOLVED 2026-08-21, out of band — the phone answered before the spike started.**
>
> `free -h` under Termux reported `MemTotal` ≈ **7.3 GiB → the 8 GB retail variant**, exactly the
> carve-out the trap below warns about (7.3 read from an 8 GB phone). Recorded in
> `docs/13-on-device-verification.md`. Spec §6 risk 2 is closed for this device and **open for the
> 6 GB variant, which stays UNKNOWN and is never assumed fine** — inference runs 6 GB → 8 GB only,
> never the reverse, so every result below is captioned "on 8 GB; 6 GB unmeasured".
>
> **What the reading also produced, which this task did not ask for:** 4.2 G used, **2.9 G available**,
> **1.6 G of zram already swapped at idle** with PeraPlano not even running. Two consequences that
> reach past this task:
>
> 1. **Tier 5 (`qwen3-4b-2507-q6`, ~3.3 GB) cannot load on this device** — it exceeds measured
>    available memory outright. Tier 4 (~2.5 GB) leaves nothing for the app. On the 8 GB A54 the
>    practical ceiling is **tier 3**, not tier 4. §2.2's `minRamBytes` gate has to be set from
>    *available* memory under real conditions, not from total RAM minus a guess.
> 2. **A phone that is already swapping at idle** is the baseline Task 7 measures against. Do not
>    treat 2.9 G as a budget; treat it as the high-water mark of a device under existing pressure.
>
> Steps 1–4 below are kept as the written method. Re-run them with `adb` if the retail-variant
> cross-check in step 2 is ever wanted as corroboration; the conclusion will not change.

**Files:**
- Modify: `docs/13-on-device-verification.md` (append a row to the "What is already proven" table at :110-116)

**Why this is task 1 and not a step inside the spike:** spec §6 risk 2 says the A54 5G ships in 6 GB and 8 GB variants, that tier 5 will not load on the 6 GB variant and tier 4 is marginal there, and that *"which of those two the owner's device is decides how much of §7 can even be measured."* Every peak-RSS question below is interpreted differently depending on the answer. It is also answerable in about ninety seconds with a phone and a USB cable, with no build, no dependency and no code. Doing it after the build is done is doing it in the wrong order.

**The trap:** `/proc/meminfo`'s `MemTotal` is **not** the marketing RAM figure. It excludes memory the kernel and the bootloader carved out before Linux started — on a mid-range Samsung that is commonly 400–700 MB. A device reporting `MemTotal: 5.5 GiB` is an 6 GB phone, not a 5.5 GB one, and reading it as the latter would wrongly disqualify a tier. Record **both** the raw value and the variant you conclude from it, and say which is which.

- [ ] **Step 1: Read the physical total**

Phone connected, USB debugging on:

```bash
adb shell cat /proc/meminfo | head -3
adb shell getprop ro.product.model
adb shell getprop ro.product.name
```

Record `MemTotal` in kB exactly as printed.

- [ ] **Step 2: Cross-check against the retail variant**

```bash
adb shell dumpsys meminfo | head -20
```

`Total RAM:` in `dumpsys meminfo` is the same underlying figure. Take the model string from step 1 (`SM-A546…`) and confirm against Samsung's published variant list which RAM options that exact model code shipped with in the Philippines. If the model code shipped in only one RAM size, that is the answer and the `MemTotal` reading is the corroboration.

- [ ] **Step 3: Record the fact, and record the unmeasurable half as unknown**

Append to the table in `docs/13-on-device-verification.md`:

```markdown
| A54 5G RAM variant | `SM-A546__`, `MemTotal: ________ kB` → **_ GB retail variant** (2026-08-__). `MemTotal` is below the retail figure by the kernel/bootloader carve-out; the retail variant is the number tiers are gated against. **The other variant is UNKNOWN and is never assumed fine** (AI spec §6, risk 2). |
```

Spec §6 risk 2 is explicit: *"The unmeasured variant must be recorded as unknown, never assumed fine."* If the device is 8 GB, every peak-RSS result below carries the caveur "on 8 GB; 6 GB unmeasured". If it is 6 GB, tiers 4 and 5 are being measured on the hard case and an 8 GB pass can be *inferred* — inference in that direction is safe, the other is not.

- [ ] **Step 4: Commit**

```bash
git add docs/13-on-device-verification.md
git commit -m "docs: record the A54 RAM variant the AI tier gate depends on"
```

---

## Task 2: Re-verify the Qwen3 licence, and give the check an owner

> **DONE 2026-08-31.** All three upstream repos read as `apache-2.0`, commercial use permitted, and
> both third-party GGUF repos under consideration (`unsloth/Qwen3-1.7B-GGUF`,
> `unsloth/Qwen3-4B-Instruct-2507-GGUF`) also read as `apache-2.0` with no added terms. No tier is
> cut on licence grounds.
>
> **The table lives in `docs/superpowers/specs/2026-08-31-model-hosting-decision.md` §0, not in the
> findings doc this task describes** — one file now answers "may we ship this file, and where does it
> come from", which is what the implementation plan's Task 2 asked for anyway. The expiry rule and
> the 60-day redo trigger came with it. Step 3's findings-doc header is still created by Task 12.

**Files:**
- Create: `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md` (started here; the rest of the file is filled in by later tasks)

**Why this task exists:** the spec states *"verify against current terms before committing"* **four separate times** — §2.1, §2.1's Qwen2.5 warning, §8.4, and the tier table's own footnote — and assigns it to nobody. A requirement repeated four times and owned by no one is a requirement that does not happen. It is also the cheapest possible task and the one with the largest blast radius: `docs/07-privacy-and-compliance.md` §8 records that PeraPlano has a paid tier, and **Qwen2.5-3B and Qwen2.5-72B ship under the Qwen Research License, which is non-commercial** — shipping either would be a licence violation in a product that charges money.

**Owner:** the repo owner, or whoever executes this plan. Not "the team". Write a name in the findings doc.

- [ ] **Step 1: Read the current licence for every model in the §2.1 table**

For each of `Qwen/Qwen3-0.6B`, `Qwen/Qwen3-1.7B`, `Qwen/Qwen3-4B-Instruct-2507`, open the model card on Hugging Face and read the **licence file linked from that card as it stands today**, not a summary, not a blog post, and not the licence of a GGUF re-upload — a third-party quantiser's repo may carry a different licence file from the upstream weights, and it is the upstream terms that bind.

Record, per model: the licence name, the URL you read it at, the repo revision or commit hash the card was at, and the date.

- [ ] **Step 2: Confirm the two things that would kill the menu**

Two specific checks, because these are the failure modes:

1. **Is it Apache-2.0, or has it moved to a Qwen-specific licence?** Qwen has shipped both. A move to a research or non-commercial licence removes that tier from the menu outright.
2. **Does any GGUF conversion you intend to host or link add terms?** A quantiser can add a licence on top of the weights. If the intended source is a third-party GGUF, its terms are the ones the download is governed by.

- [ ] **Step 3: Write the finding, including the negative result if it is one**

Create `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md` with this header and this first section:

```markdown
# llama.rn Spike Findings

**Device:** Samsung A54 5G, `SM-A546__`, __ GB variant (see docs/13-on-device-verification.md).
**Dates run:** ____
**Run by:** ____
**Spec this answers:** `docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` §7.1

---

## 0. Licence re-verification (spec §2.1, §8.4)

**Owner:** ____   **Checked:** 2026-__-__

| Model | Licence as read today | Read at | Revision | Commercial use permitted? |
|---|---|---|---|---|
| Qwen3-0.6B | ____ | ____ | ____ | ____ |
| Qwen3-1.7B | ____ | ____ | ____ | ____ |
| Qwen3-4B-Instruct-2507 | ____ | ____ | ____ | ____ |
| (GGUF source, if third-party) | ____ | ____ | ____ | ____ |

**Verdict:** ____

**Re-check trigger:** this check expires. Re-read before the catalogue ships and before any
tier is added. A licence read in August is not evidence in November — the spec says so, and
that sentence is the reason this table has a date column.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md
git commit -m "docs: re-verify Qwen3 licence terms for the on-device assistant"
```

**If any tier's licence is not commercially usable:** stop and report it before building the spike app. The spike can still run on a usable tier — it is measuring the runtime, not the model — but the tier table in spec §2.1 needs amending first, and that is a change to the design document, not a footnote in a findings file.

---

## Task 3: Stand up the throwaway app

> **Amended 2026-08-31, from actually running it.** Four things the written steps get wrong on this
> machine, each found by hitting it:
>
> 1. **`create-expo-app` now scaffolds SDK 57 / RN 0.86.3 / React 19.2.3.** This plan's Tech Stack
>    line says SDK 54 / RN 0.81.5, and `mobile/package.json` really is on `expo ~54.0.36`,
>    `react-native 0.81.5`, `react 19.1.0`. **A spike on RN 0.86 measures nothing about a product on
>    RN 0.81** — `llama.rn` is a JSI/TurboModule library, so both "does it build" and "how fast is
>    it" are runtime-version-specific. Pin after scaffolding: `npm install expo@~54.0.36` then
>    `npx expo install --fix`, and verify the three versions against `mobile/package.json` before
>    building anything.
> 2. **`llama.rn`'s `latest` dist-tag is a release candidate** (`0.13.0-rc.2`); the last stable is
>    `0.12.9`. A bare `npm install llama.rn` silently puts an RC into a finance app's dependency
>    tree. Pinned to `0.12.9` with `--save-exact`. If it will not build against RN 0.81.5, falling
>    back to the RC is legitimate but must be recorded as a finding, not done quietly.
> 3. **`npm install llama.rn` fails under Git Bash on Windows.** Its postinstall extracts prebuilt
>    JNI libs and MSYS `tar` reads the Windows path as a remote host:
>    `tar (child): Cannot connect to C: resolve failed`, then
>    `tar: Error is not recoverable: exiting now`. Run the install from **PowerShell**, where `tar`
>    is Windows bsdtar. Verified fix; 9 `.so` files extracted afterwards, `arm64-v8a` and `x86_64`
>    only.
> 4. **The app is built at `D:\llama_probe`, not at `spike/llama_probe/` inside the repo.** Project
>    memory records a MAX_PATH build failure on this machine (the reason SDK ninja 1.10.2 was
>    swapped for 1.13.0). A worktree path is already 62 characters before `android/app/.cxx/...`
>    nesting begins. Deliberate deviation; the app is throwaway either way and only the findings doc
>    is ever merged.
>
> Toolchain confirmed present before building: Node 22.12.0, npm 10.9.0, Temurin JDK 17.0.19,
> NDK 27.1.12297006, cmake 3.22.1, and `ninja.exe` reporting **1.13.0** with `ninja-1.10.2.exe.bak`
> beside it, so the memory-recorded swap is still in place.

**Files:**
- Create: `spike/llama_probe/` (whole tree)
- Create: `spike/llama_probe/README.md`

**Interfaces:**
- Produces: a dev-client APK installable alongside PeraPlano, with `llama.rn` linked and a screen that renders. Later tasks add measurements to it; none of them re-solve the build.

- [ ] **Step 1: Create the branch and the app**

```bash
git switch -c spike/llama-rn-probe
mkdir -p spike
cd spike
npx create-expo-app@latest llama_probe --template blank-typescript
cd llama_probe
npx expo install expo-dev-client expo-device expo-file-system
npm install llama.rn
```

`expo-device` is installed here and only here — question 7 needs it, and installing it in the spike is how we find out whether it answers correctly *before* `mobile/package.json` ever gains it.

- [ ] **Step 2: Pin the app id and the ABI**

In `spike/llama_probe/app.json`:

```json
{
  "expo": {
    "name": "LlamaProbe",
    "slug": "llama-probe",
    "android": {
      "package": "com.filldev.llamaprobe"
    },
    "plugins": ["expo-dev-client"]
  }
}
```

Then prebuild and set the ABI filter, because Expo has no `app.json` knob for it:

```bash
npx expo prebuild --platform android --clean
```

In the generated `spike/llama_probe/android/gradle.properties`, set:

```properties
reactNativeArchitectures=arm64-v8a
```

**Why the ABI filter is not optional:** question 6 asks for the APK size delta from adding the library. `llama.rn` ships prebuilt native libraries per ABI. A four-ABI APK's delta is roughly four times the number the product would actually pay, and reporting it would trigger spec §7.3's "APK delta over ~40 MB → revisit Play Feature Delivery" row on evidence that does not exist.

- [ ] **Step 3: Apply the ninja swap and build**

Per project memory (*Android ninja swap*): the Android SDK's bundled ninja 1.10.2 aborts local builds on this machine with a MAX_PATH failure and 1.13.0 is already swapped in with a backup kept. Confirm the swapped binary is the one on `PATH` for this build, then:

```bash
npx expo run:android --device
```

- [ ] **Step 4: Confirm it launched, and confirm the library is actually in the APK**

```bash
adb shell pm list packages | grep llamaprobe
unzip -l spike/llama_probe/android/app/build/outputs/apk/debug/app-debug.apk | grep -i "\.so" | grep -i "arm64"
```

Expected: the package is listed, and `lib/arm64-v8a/` contains `llama.rn`'s shared objects (`librnllama*.so` or similar) and no `armeabi-v7a`, `x86` or `x86_64` directory.

- [ ] **Step 5: Write the README that stops this becoming the product**

`spike/llama_probe/README.md`:

```markdown
# llama_probe — THROWAWAY

This app exists to answer the seven questions in
`docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` §7.1 on a real
Samsung A54 5G, and then to be deleted.

**Nothing here is merged to master.** Not the app, not `lib/probe.ts`, not the grammar
fixture. The only artefact that survives is
`docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md`.

If you find yourself adding a database, a repository, a lock, or a second screen to this
app, stop: you are building the feature, and the feature has an implementation plan
(`docs/superpowers/plans/2026-08-20-on-device-ai-assistant.md`) that is waiting on this
app's numbers rather than on its code.
```

- [ ] **Step 6: Commit**

```bash
git add spike/
git commit -m "chore(spike): throwaway expo dev client with llama.rn, arm64-only"
```

---

## Task 4: Question 1 — does `llama.rn` load a Qwen3 GGUF and stream tokens?

**Files:**
- Create: `spike/llama_probe/lib/probe.ts`
- Modify: `spike/llama_probe/app/index.tsx`

**Interfaces:**
- Produces: `runPrompt(opts): Promise<ProbeResult>` where
  `ProbeResult = { ttftMs: number; tokenCount: number; wallMs: number; text: string; tokensPerSecond: number }`.
  Every later task consumes this; none of them re-implements timing.

**Spec §7.1 question 1**, and everything else is downstream of it — spec §5.6 gate 1 says so in the same words.

**Start with `qwen3-1.7b-q4`**, the middle of the menu, exactly as §7.1 says. Not the smallest: a 0.6B that streams proves the runtime works and tells you nothing about whether the tier anyone will use does. Not the largest: a 4B that fails leaves you unable to tell a runtime problem from a memory problem.

- [ ] **Step 1: Get the weights onto the phone without building a downloader**

The downloader is spec §2.3's problem and belongs to the implementation plan. Here, push the file:

```bash
adb push qwen3-1.7b-q4.gguf /sdcard/Download/
adb shell run-as com.filldev.llamaprobe mkdir -p files/models
adb shell "cp /sdcard/Download/qwen3-1.7b-q4.gguf /data/local/tmp/"
```

Then have the app copy from `/data/local/tmp/` into its own `documentDirectory + "models/"` on first launch, or read directly from a path the app can see. **Record which path you used** — a model read from external storage may perform differently from one in app-private storage, and if the numbers look strange this is the first thing to re-check.

- [ ] **Step 2: Write the timing wrapper**

`spike/llama_probe/lib/probe.ts`:

```ts
// spike/llama_probe/lib/probe.ts — THROWAWAY. See ../README.md.
//
// TTFT IS MEASURED FROM THE CALL, NOT FROM THE LOAD. A number that includes
// model load time answers a different question (§7.1 q10-adjacent, "reload
// after a process kill") and is the reason the two are separate fields here.
import { initLlama, type LlamaContext } from "llama.rn";

export type ProbeResult = {
  /** ms from calling completion() to the first token callback firing. */
  ttftMs: number;
  tokenCount: number;
  /** ms from the call to the final token. */
  wallMs: number;
  text: string;
  /** tokenCount / (wallMs - ttftMs) * 1000 — DECODE rate, prefill excluded. */
  tokensPerSecond: number;
};

let context: LlamaContext | null = null;

export async function loadModel(path: string, contextTokens: number): Promise<number> {
  const started = Date.now();
  if (context) { await context.release(); context = null; }
  context = await initLlama({ model: path, n_ctx: contextTokens, n_gpu_layers: 0 });
  return Date.now() - started;   // load ms — record it, §6 risk 10 wants it
}

export async function runPrompt(
  prompt: string,
  grammar: string | null,
): Promise<ProbeResult> {
  if (!context) throw new Error("probe: no model loaded");
  const started = Date.now();
  let firstTokenAt: number | null = null;
  let tokenCount = 0;
  let text = "";

  const result = await context.completion(
    { prompt, n_predict: 256, ...(grammar ? { grammar } : {}) },
    (token) => {
      if (firstTokenAt === null) firstTokenAt = Date.now();
      tokenCount += 1;
      text += token.token;
    },
  );

  const wallMs = Date.now() - started;
  const ttftMs = (firstTokenAt ?? Date.now()) - started;
  const decodeMs = Math.max(1, wallMs - ttftMs);
  return {
    ttftMs,
    tokenCount,
    wallMs,
    text: text || String(result.text ?? ""),
    tokensPerSecond: (tokenCount / decodeMs) * 1000,
  };
}
```

**Note on the API surface:** `llama.rn`'s exact export names and option keys are what this spike is here to discover. If `initLlama`/`completion`/`release` are not the names it ships, **fix them from the installed package's own type definitions in `node_modules/llama.rn/`, and record the real surface in the findings doc under question 1.** The implementation plan's `modules/llama_bridge/index.ts` is written against whatever this task learns — that is precisely what spec §1.1's boundary is for, and a wrong guess recorded here is cheaper than a wrong guess in `mobile/`.

- [ ] **Step 3: Wire the one screen**

`spike/llama_probe/app/index.tsx` renders: a model path input, a prompt box, a grammar toggle, a Run button, and a scrollable log that appends one line per run — `ttftMs`, `tokenCount`, `wallMs`, `tokensPerSecond`, and the raw text. Streaming is visible token by token, because question 9 of §5.6 (does streaming read as alive) gets its first informal look here even though it is formally an implementation-phase gate.

- [ ] **Step 4: Run it three times, cold, off charge**

Three runs, same prompt, ~60 tokens of expected output. Kill the app between runs (`adb shell am force-stop com.filldev.llamaprobe`) so each is a cold start.

- [ ] **Step 5: Record**

Into the findings doc:

```markdown
## 1. Does llama.rn load a Qwen3 GGUF and stream? (spec §7.1 q1, §5.6 gate 1)

**Model:** qwen3-1.7b-q4 · **Path used:** ____ · **Context tokens:** ____

| Run | Load ms | TTFT ms | Tokens | Wall ms | tok/s (decode) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| **median** | | | | | |

**Estimated band in spec §2.1 for this tier:** 12–20 tok/s. **Measured:** ____.
**`llama.rn` API surface actually used:** ____ (this is what `modules/llama_bridge/index.ts` binds to.)
**Answer:** ____
```

- [ ] **Step 6: Commit**

```bash
git add spike/llama_probe/lib/probe.ts spike/llama_probe/app/index.tsx
git commit -m "feat(spike): measure llama.rn load, TTFT and decode rate"
```

---

## Task 5: Question 2 — does llama.cpp accept a per-request GBNF, and does it hold?

**Files:**
- Create: `spike/llama_probe/lib/grammar_fixture.ts`
- Modify: `spike/llama_probe/app/index.tsx`

**Spec §7.1 question 2, §5.6 gate 2, and §6 risk 5** — and this is the highest-leverage question in the spike after tool-pick accuracy. Spec §3.3's claim is that the model *cannot* emit invalid JSON, an unknown tool name, an unknown enum value, or `limit: 21`. If GBNF is unsupported or applies only at load time, that claim is gone and §7.3's first row fires: the loop needs parse-and-retry, and the tool-call format collapses to a bare name and arguments on one line.

**Two sub-questions, and they are not the same:**
1. Does it accept a grammar **string per request**? A runtime that takes a grammar only at context creation cannot serve §3.4's forced-answer round, which needs a *different, prose-only* grammar in the fourth call of the same turn.
2. Does constrained decoding actually **hold** for 50 generations? Target: **zero** malformed outputs.

- [ ] **Step 1: Hand-write one grammar**

`spike/llama_probe/lib/grammar_fixture.ts`:

```ts
// spike/llama_probe/lib/grammar_fixture.ts — THROWAWAY.
//
// HAND-WRITTEN, NOT GENERATED, DELIBERATELY. Question 2 asks whether
// llama.cpp's GBNF parser agrees with our reading of the format. A generator
// would put our own compiler bug between us and that answer, and a failure
// would be unattributable. `lib/ai/tools/grammar.ts` is written AFTER this
// answer, against a format this file has already proved.
export const GET_SPEND_BY_CATEGORY_GRAMMAR = `
root        ::= tool-call | prose
tool-call   ::= "{\\"tool\\":\\"get_spend_by_category\\",\\"args\\":{\\"period\\":" period "}}"
period      ::= "\\"this_month\\"" | "\\"last_month\\"" | "\\"last_7_days\\"" | "\\"last_30_days\\""
prose       ::= [^{] [^\\n]*
`;

/** The forced-answer round's grammar (§3.4). A DIFFERENT string, same context. */
export const PROSE_ONLY_GRAMMAR = `
root  ::= [^{] [^\\n]*
`;
```

- [ ] **Step 2: Run 50 constrained generations and count failures**

Fifty runs against `GET_SPEND_BY_CATEGORY_GRAMMAR` with varied prompts (some that should produce a tool call, some that should produce prose). A run is **malformed** if the output is neither valid JSON matching the tool-call shape nor a line that does not begin with `{`. Count them mechanically in `score.ts`-adjacent code, not by eye — fifty outputs read by a tired human is a measurement with an error bar wider than the thing being measured.

- [ ] **Step 3: Prove the per-request part specifically**

In one session, without releasing the context: run with `GET_SPEND_BY_CATEGORY_GRAMMAR`, then immediately run with `PROSE_ONLY_GRAMMAR`, then with `null`. If the second run can still emit a tool call, the grammar is sticky rather than per-request and §7.3's reshape row fires.

**This is the assertion that matters and it is easy to skip.** A test that only ever passes one grammar proves the runtime accepts *a* grammar, which is not the question.

- [ ] **Step 4: Record**

```markdown
## 2. GBNF: accepted per request, and does it hold? (spec §7.1 q2, §5.6 gate 2, §6 risk 5)

**Accepted as a per-request option:** yes / no — option key used: `____`
**Changing the grammar between two calls on the SAME context takes effect:** yes / no
**Passing `null`/omitting it returns to unconstrained:** yes / no
**50 constrained generations, malformed count:** ____ / 50 (target: 0)
**Malformed examples, if any:** ____

**Consequence if "no" to per-request:** spec §7.3 row 1 — the loop needs parse-and-retry and
the tool-call format drops to a bare name + args on one line. The implementation plan's
Phase 3 and Phase 7 are both gated on this answer.
**Answer:** ____
```

- [ ] **Step 5: Commit**

```bash
git add spike/llama_probe/lib/grammar_fixture.ts spike/llama_probe/app/index.tsx
git commit -m "feat(spike): 50-generation GBNF conformance and per-request grammar check"
```

---

## Task 6: Question 3 — can thinking be suppressed, and what does it cost?

**Files:**
- Modify: `spike/llama_probe/lib/probe.ts`
- Modify: `spike/llama_probe/app/index.tsx`

**Spec §7.1 question 3, §2.1's `suppressThinking` field, §5.6 gate 3, §7.3's last row.** Tiers 1–3 are hybrid-thinking Qwen3 and emit `<think>…</think>` unless suppressed; the 2507 instruct refreshes do not think and must not be told to. The spec is explicit about why this is an on-device gate and not a unit test: *"if suppression silently fails, the tokens are still decoded and paid for in latency"* — a post-hoc stripper produces clean output and an unchanged bill.

**So the measurement is not "is there a `<think>` tag in the output". It is "did TTFT and total wall clock change".** A suppression that removes the tag without moving the clock is not suppression; it is a string operation.

- [ ] **Step 1: Find the suppression lever**

Two candidates, in order of preference:
1. The chat template's thinking flag, if `llama.rn` exposes the template application (`enable_thinking: false`, `/no_think` in the prompt, or a template parameter — the exact form is what this step discovers).
2. A stream-level `<think>` stripper, which the spec calls "belt-and-braces" and which is the fallback, not the answer.

Record which one worked and whether both were available.

- [ ] **Step 2: Measure three configurations on `qwen3-1.7b-q4`**

Same prompt, three runs each, cold:

| Config | What it tells you |
|---|---|
| No suppression | The baseline TTFT and wall clock, thinking tokens included |
| Template-level suppression | Whether the model genuinely skips thinking |
| Stripper only | Whether output is clean while the bill is unchanged — the failure this gate exists to catch |

- [ ] **Step 3: Record**

```markdown
## 3. Thinking suppression on hybrid tiers (spec §7.1 q3, §5.6 gate 3)

**Lever found:** template flag / prompt token / stripper only / none — form: `____`

| Config | median TTFT ms | median wall ms | median tokens | `<think>` visible? |
|---|---|---|---|---|
| unsuppressed | | | | |
| template-suppressed | | | | |
| stripper only | | | | |

**Did suppression measurably change the clock?** yes / no
**Consequence if no:** spec §7.3 last row — tiers 1–3 pay a latency tax on every answer, and
either that is accepted and every §2.1 estimate re-measured, or the menu becomes the two 2507
tiers only, which contradicts §0.3's free-for-everyone goal since neither runs comfortably on a
6 GB phone. **This is a menu-shaping finding, not a tuning note.**
**Answer:** ____
```

- [ ] **Step 4: Commit**

```bash
git add spike/llama_probe/
git commit -m "feat(spike): measure whether think suppression changes latency or only output"
```

---

## Task 7: Question 4 — peak RSS, and survival across an app switch

**Files:**
- Modify: `spike/llama_probe/app/index.tsx` (a "load and hold" mode)

**Spec §7.1 question 4, §5.6 gate 4 — which the spec calls "the gate most likely to reshape the menu" — and §6 risk 2.** No unit test can see this.

**Measure with `adb`, not with JS.** A JS heap reading knows nothing about the native allocation `llama.cpp` made, which is where essentially all of the memory is. `dumpsys meminfo` is the instrument.

- [ ] **Step 1: For each of 0.6B, 1.7B-Q4 and 4B-Q4, load and hold**

Push all three GGUFs first. Then per model:

```bash
adb shell am force-stop com.filldev.llamaprobe
# launch, load the model, start a long generation, then:
adb shell dumpsys meminfo com.filldev.llamaprobe | head -30
```

Record **TOTAL PSS** and **Native Heap**. Take the reading *during* generation, not after — the KV cache is at its largest while decoding, and a post-generation figure understates the peak.

- [ ] **Step 2: The app-switch survival test, exactly as the spec words it**

Per model, after loading:

1. Background the app (Home).
2. Open the camera app and take a photo. (The camera is chosen deliberately: it is the largest memory allocation an ordinary user makes casually, and it is what actually kills backgrounded processes on a mid-range phone.)
3. Return to the probe.
4. Did the process survive, or did it cold-restart?

```bash
adb shell "ps -A | grep llamaprobe"       # before
# ...switch away, camera, switch back...
adb shell "ps -A | grep llamaprobe"       # after — same PID, or a new one?
```

**A new PID is a failure, even if the app looks fine.** The user's conversation, the KV cache, and the loaded weights are all gone; the app merely restarted quickly enough to hide it.

- [ ] **Step 3: Record**

```markdown
## 4. Peak memory and app-switch survival (spec §7.1 q4, §5.6 gate 4, §6 risk 2)

**Device RAM variant:** __ GB (Task 1). **The other variant is UNMEASURED.**

| Model | TOTAL PSS (MB) | Native Heap (MB) | PID before | PID after camera | Survived? |
|---|---|---|---|---|---|
| qwen3-0.6b-q4 | | | | | |
| qwen3-1.7b-q4 | | | | | |
| qwen3-4b-2507-q4 | | | | | |

**Consequence if 1.7B-Q4 does not survive on 6 GB:** spec §7.3 row 3 — the menu collapses to
tier 1 on half the devices and the §5.5 tier cut is moot before it runs.
**Consequence for `minRamBytes`:** these PSS figures are the empirical basis for the catalogue's
`minRamBytes` values, which spec §2.2 requires to be strictly greater than `bytes`. Without this
table, `minRamBytes` is a guess with a unit test asserting the guess is bigger than another guess.
**Answer:** ____
```

- [ ] **Step 4: Commit**

```bash
git add spike/llama_probe/
git commit -m "feat(spike): load-and-hold mode for peak RSS and app-switch survival"
```

---

## Task 8: Question 5 — strict tool-pick accuracy at three sizes

**Files:**
- Create: `spike/llama_probe/lib/eval_12.ts`
- Create: `spike/llama_probe/lib/score.ts`
- Modify: `spike/llama_probe/app/index.tsx`

**Spec §7.1 question 5.** Three points is enough to see the shape of the curve; the full 30-question set is the implementation plan's Phase 9, not this.

**This is the question that decides whether the feature ships as a chat surface at all** (§6 risk 1, §7.3 row 2, §7.4). It gets the most careful design here.

**Composition of the 12, scaled down from §5.5's 30 while keeping every failure mode represented:**

| Count | Kind | Why it survives the cut |
|---|---|---|
| 5 | Single-tool, one per tool for five of the seven, mixed English and Taglish | Base tool selection and code-switching. Dropping the Taglish half would measure a user population that does not exist (§5.5). |
| 3 | Period discrimination — obvious tool, contested argument | The classic small-model failure: right tool, **wrong period**. Cutting these would inflate the score by removing the hard cases. |
| 2 | Two-tool | Multi-round dispatch. |
| 2 | Out of scope ("what's the weather?") | Over-eager tool use. Correct behaviour is a stated inability; picking any tool is a failure. |

The 2 advice questions from §5.5's set are **deliberately excluded here** — their correct result is *zero inference calls*, which is a property of `triage.ts`, and `triage.ts` does not exist yet. Measuring them in the spike would measure nothing.

- [ ] **Step 1: Author the 12 questions and the hardcoded fixture**

`spike/llama_probe/lib/eval_12.ts`:

```ts
// spike/llama_probe/lib/eval_12.ts — THROWAWAY. A cut-down of spec §5.5's 30.
//
// A SYNTHETIC LEDGER, HARDCODED, FOR THE SAME THREE REASONS §5.5 GIVES:
// comparability across the three model sizes, known answers so scoring is
// possible at all, and no contact with anyone's real finances.
export type EvalQuestion = {
  id: string;
  text: string;
  language: "en" | "taglish";
  /** null = no tool call is the correct answer (out-of-scope questions). */
  expected: { tool: string; args: Record<string, unknown> } | null;
};

export const FIXTURE_TOOL_RESULTS = {
  get_spend_by_category: {
    this_month: [
      { key: "Groceries", value: "₱2,400.00", kind: "amount" },
      { key: "Groceries share", value: "34%", kind: "percent" },
      { key: "Transport", value: "₱1,150.00", kind: "amount" },
    ],
  },
  get_safe_to_spend: [{ key: "per day", value: "₱480.00", kind: "amount" }],
  get_limits: [
    { key: "Monthly limit", value: "₱12,000.00", kind: "amount" },
    { key: "Spent", value: "₱7,050.00", kind: "amount" },
  ],
  get_balance_total: [{ key: "total", value: "₱18,320.00", kind: "amount" }],
  get_wallets: [{ key: "wallets", value: "4", kind: "count" }],
} as const;

export const QUESTIONS: EvalQuestion[] = [
  { id: "q01", text: "What's my biggest spending category this month?", language: "en",
    expected: { tool: "get_spend_by_category", args: { period: "this_month" } } },
  { id: "q02", text: "magkano na nagastos ko this month?", language: "taglish",
    expected: { tool: "get_spend_by_category", args: { period: "this_month" } } },
  { id: "q03", text: "How much can I spend today?", language: "en",
    expected: { tool: "get_safe_to_spend", args: {} } },
  { id: "q04", text: "Malapit na ba akong lumagpas sa limit ko?", language: "taglish",
    expected: { tool: "get_limits", args: {} } },
  { id: "q05", text: "How much money do I have altogether?", language: "en",
    expected: { tool: "get_balance_total", args: {} } },
  // Period discrimination — same tool, contested argument.
  { id: "q06", text: "What did I spend on last month?", language: "en",
    expected: { tool: "get_spend_by_category", args: { period: "last_month" } } },
  { id: "q07", text: "Show me the last 7 days of spending by category.", language: "en",
    expected: { tool: "get_spend_by_category", args: { period: "last_7_days" } } },
  { id: "q08", text: "nung nakaraang buwan, saan napunta ang pera ko?", language: "taglish",
    expected: { tool: "get_spend_by_category", args: { period: "last_month" } } },
  // Two-tool.
  { id: "q09", text: "How much is left in my limit, and what's my biggest category?",
    language: "en", expected: { tool: "get_limits", args: {} } },
  { id: "q10", text: "Ilan ang wallets ko at magkano lahat?", language: "taglish",
    expected: { tool: "get_wallets", args: {} } },
  // Out of scope — correct answer is NO tool call.
  { id: "q11", text: "What's the weather today?", language: "en", expected: null },
  { id: "q12", text: "Sino ang presidente ng Pilipinas?", language: "taglish", expected: null },
];
```

**On q09 and q10:** a two-tool question scores on its **first** tool call, per §5.5's definition. The expected value above is the tool the first call should be. That is a judgement about which half of the question a model reads first, and it is worth writing down in the findings if a model consistently picks the other one — that is a prompt-ordering finding, not a failure.

- [ ] **Step 2: Write the strict scorer**

`spike/llama_probe/lib/score.ts`:

```ts
// spike/llama_probe/lib/score.ts — THROWAWAY.
//
// STRICT, PER SPEC §5.5: a question scores 1 only if the FIRST tool call has
// the expected name AND its args deep-equal the expected args. No partial
// credit — right tool with the wrong period is a wrong answer to the user, so
// it must be a wrong answer to the score. The two sub-counters exist because
// "picked get_spend_by_category with last_month" and "picked list_transactions"
// are different problems with different fixes.
import type { EvalQuestion } from "./eval_12";

export type Score = {
  id: string;
  strict: 0 | 1;
  nameCorrect: boolean;
  argsCorrect: boolean;
  emitted: { tool: string; args: unknown } | null;
};

export function firstToolCall(output: string): { tool: string; args: unknown } | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return null;
  const end = trimmed.indexOf("}", trimmed.indexOf("}") + 1);
  try {
    const parsed = JSON.parse(trimmed.slice(0, end + 1));
    if (typeof parsed?.tool !== "string") return null;
    return { tool: parsed.tool, args: parsed.args ?? {} };
  } catch { return null; }
}

export function scoreOne(question: EvalQuestion, output: string): Score {
  const emitted = firstToolCall(output);

  if (question.expected === null) {
    // Out of scope: picking ANY tool is a failure.
    return { id: question.id, strict: emitted === null ? 1 : 0,
             nameCorrect: emitted === null, argsCorrect: emitted === null, emitted };
  }
  if (emitted === null) {
    return { id: question.id, strict: 0, nameCorrect: false, argsCorrect: false, emitted };
  }
  const nameCorrect = emitted.tool === question.expected.tool;
  const argsCorrect =
    JSON.stringify(emitted.args) === JSON.stringify(question.expected.args);
  return {
    id: question.id,
    strict: nameCorrect && argsCorrect ? 1 : 0,
    nameCorrect,
    argsCorrect,
    emitted,
  };
}
```

- [ ] **Step 3: Run all 12 against 0.6B, 1.7B-Q4 and 4B-Q4, three times each**

Three runs per model, because §5.5 requires a noise floor before any comparison and this spike's whole job is to make the comparison meaningful. 36 runs of 12 questions. At 4 tok/s on the 4B this is a long sitting — that itself is a finding, and it is the same finding §2.5 wants ("total wall clock for the 30 — whether the user will sit through the eval at all").

- [ ] **Step 4: Record**

```markdown
## 5. Strict tool-pick accuracy at three sizes (spec §7.1 q5)

| Model | Run 1 /12 | Run 2 /12 | Run 3 /12 | Median | name-correct | args-correct | wall clock for 12 |
|---|---|---|---|---|---|---|---|
| qwen3-0.6b-q4 | | | | | | | |
| qwen3-1.7b-q4 | | | | | | | |
| qwen3-4b-2507-q4 | | | | | | | |

**Run-to-run spread within a single tier:** ____ (this is the noise floor §5.5's tier cut needs)
**Which questions failed on every model:** ____
**Period discrimination (q06–q08) specifically:** ____ / 9 per model

**The §7.2 bar:** 4B strict tool-pick **comfortably above 70%** (≥ 9/12).
**The §6 risk 7 bar nobody set but everyone needs:** tier 1 (0.6B) is the only tier casually
downloadable on a Philippine prepaid plan and therefore the tier most users will actually try.
Record its score prominently even though §7.2 does not gate on it — risks 1 and 7 are the same
risk seen from two sides, and doc amendment 1 in
`docs/superpowers/plans/2026-08-20-on-device-ai-doc-amendments.md` is sequenced behind this cell.
**Answer:** ____
```

- [ ] **Step 5: Commit**

```bash
git add spike/llama_probe/lib/eval_12.ts spike/llama_probe/lib/score.ts spike/llama_probe/app/index.tsx
git commit -m "feat(spike): 12-question strict tool-pick eval across three model sizes"
```

---

## Task 9: Questions 6 and 7 — APK delta, and whether `Device.totalMemory` tells the truth

**Files:**
- Modify: `spike/llama_probe/app/index.tsx`

Two small questions, folded into one task because neither carries its own test cycle and both are read off the same build.

**Question 6 (§7.1, §6 risk 3):** `llama.rn` ships prebuilt native libraries; they are in the APK for every user, including the ones who never enable the assistant. §7.3's row: over ~40 MB and Play Feature Delivery becomes the next conversation.

**Question 7 (§7.1, and it gates `ram_gate.ts`):** does `Device.totalMemory` report the physical total on an A54, and does it agree with `/proc/meminfo`? A reader that under-reports hides tiers the phone can actually run. Task 1 already has the `/proc/meminfo` figure to compare against, which is the other reason Task 1 went first.

- [ ] **Step 1: Build twice and diff**

```bash
# With llama.rn (current state)
cd spike/llama_probe && npx expo run:android --variant release --no-install
ls -l android/app/build/outputs/apk/release/app-release.apk

# Then remove it and rebuild
npm uninstall llama.rn && npx expo prebuild --platform android --clean
npx expo run:android --variant release --no-install
ls -l android/app/build/outputs/apk/release/app-release.apk

# Reinstall for the remaining tasks
npm install llama.rn && npx expo prebuild --platform android --clean
```

**Release variant, not debug.** A debug APK carries symbols and a dev bundle; its delta is not the delta a user downloads. Both builds must be arm64-only or the comparison is meaningless.

- [ ] **Step 2: Read `Device.totalMemory` on the phone**

Add to the screen:

```ts
import * as Device from "expo-device";
// Device.totalMemory is BYTES, and is ActivityManager.MemoryInfo.totalMem
// underneath — the same kernel figure /proc/meminfo's MemTotal reports, which
// is why Task 1's reading is the thing to compare it against.
const totalMemoryBytes = Device.totalMemory;
```

Display it in bytes, and also as `bytes / 1024 / 1024 / 1024` GiB to three decimals.

- [ ] **Step 3: Compare against Task 1**

`MemTotal` from `/proc/meminfo` is in **kB** (which is really KiB). `Device.totalMemory` is in **bytes**. `MemTotal_kB * 1024` should equal `Device.totalMemory` to within rounding. If it does not, `ram_gate.ts` cannot trust it and the implementation plan's Phase 5 needs a different reader — which would break spec §Global Constraints' "exactly two new dependencies" promise, since a hand-rolled native read means Kotlin in `llama_bridge` (§1.1).

- [ ] **Step 4: Record**

```markdown
## 6. APK size delta, arm64-only (spec §7.1 q6, §6 risk 3)

| Build | Release APK bytes |
|---|---|
| without llama.rn | |
| with llama.rn | |
| **delta** | |

**§7.3 threshold:** over ~40 MB → revisit Play Feature Delivery on-demand delivery.
**Answer:** ____

## 7. Does Device.totalMemory tell the truth? (spec §7.1 q7)

| Source | Value |
|---|---|
| `/proc/meminfo` MemTotal (Task 1) | ____ kB → ____ bytes |
| `Device.totalMemory` | ____ bytes |
| Agreement | ____ |

**Consequence if it under-reports:** `ram_gate.ts` hides tiers the phone can run, and the
"exactly two new dependencies" constraint is threatened, since the alternative is a native read
and therefore Kotlin inside `llama_bridge` (§1.1).
**Answer:** ____
```

- [ ] **Step 5: Commit**

```bash
git add spike/llama_probe/
git commit -m "feat(spike): APK size delta and Device.totalMemory cross-check"
```

---

## Task 10: The two questions the spike should answer while the phone is in hand

**Files:**
- Modify: `spike/llama_probe/app/index.tsx`

Neither is in §7.1. Both are cheap now and expensive later, and both are named in §6 as unresolved risks whose answers change the implementation plan.

**A. Streaming SHA-256 of a multi-gigabyte file (§6 risk 8, §5.6 gate 7).** `@noble/hashes` in JS over 3.3 GB read through `expo-file-system/legacy` may be unacceptably slow, or may not stream at all. If it does not, the digest needs a native helper and `llama_bridge` grows its first piece of Kotlin — which is a change to §1.1's whole premise, and the implementation plan's Phase 6 is written differently depending on the answer.

**B. Reload after a process kill (§6 risk 10).** Android kills the app, the user returns, and a 2.5 GB model must be re-read from storage. Task 4 already records a load time; this records it *after a force-stop with a cold page cache*, which is the number the surface's "waking up" copy is designed around.

- [ ] **Step 1: Hash the largest GGUF on the phone, in JS, and time it**

```ts
import { sha256 } from "@noble/hashes/sha2";
import * as FileSystem from "expo-file-system/legacy";
// Read in chunks — the whole point is whether a streaming read is possible at
// all. A single readAsStringAsync of 3.3 GB will OOM, and that is itself the
// finding if no chunked API exists.
```

Record: whether a chunked read is available, the chunk size used, total wall clock, and **whether the UI stayed responsive** (scroll a list while it runs).

- [ ] **Step 2: Force-stop and time a cold reload**

```bash
adb shell am force-stop com.filldev.llamaprobe
# Optionally drop caches is not available on a non-rooted device; a force-stop
# plus a few minutes of other app use is the closest honest approximation.
```

Relaunch, load `qwen3-4b-2507-q4`, record load ms.

- [ ] **Step 3: Record**

```markdown
## 8. Bonus — streaming SHA-256 and cold reload (spec §6 risks 8 and 10, §5.6 gate 7)

**Chunked file read available in expo-file-system/legacy:** yes / no — API used: `____`
**SHA-256 of a ____ GB file in JS:** ____ s, UI responsive: yes / no
**Consequence if slow or impossible:** the digest needs a native helper, `llama_bridge` grows
its first Kotlin, and §1.1's "TypeScript boundary, not a Kotlin module" premise is amended
rather than assumed.

**Cold reload of qwen3-4b-2507-q4 after force-stop:** ____ ms
**Consequence:** this is the duration the "waking up" copy must cover, and it is why §6 risk 10
requires "no model yet" and "model loading" to be visually distinct states.
```

- [ ] **Step 4: Commit**

```bash
git add spike/llama_probe/
git commit -m "feat(spike): time streaming SHA-256 and cold model reload"
```

---

## Task 11: Thermal and sustained-load behaviour

**Files:** none — this is a measurement, and its artefact is a table row.

**Spec §5.6 gate 5.** The project holds itself to <2%/day battery attribution for the notification listener; an assistant is a different profile, but *"a run that visibly heats the phone is a finding"*. This is also the closest the spike gets to §2.5's "total wall-clock for the 30 — whether the user will sit through the eval at all", which is a real product question and not an engineering one.

- [ ] **Step 1: Run a sustained ten minutes on the largest model that loads**

```bash
adb shell dumpsys battery | grep -i "level\|temperature"
# run continuously for 10 minutes
adb shell dumpsys battery | grep -i "level\|temperature"
```

`temperature` is in tenths of a degree Celsius.

- [ ] **Step 2: Record**

```markdown
## 9. Thermal and battery under sustained load (spec §5.6 gate 5)

**Model:** ____ · **Duration:** 10 min continuous decode
| | Start | End | Delta |
|---|---|---|---|
| Battery level % | | | |
| Battery temperature °C | | | |

**Did the phone throttle?** (tok/s at minute 1 vs minute 10): ____ → ____
**Subjective:** was the phone uncomfortable to hold? ____
**Answer:** ____
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md
git commit -m "docs(spike): record thermal and sustained-load measurements"
```

---

## Task 12: The verdict — and the route it takes

**Files:**
- Modify: `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md`
- Modify: `docs/13-on-device-verification.md`

**This task is the deliverable.** Everything before it produced numbers; this turns them into a decision that the implementation plan can act on.

**The three routes, and the rule that this is never a cancellation:**

Spec §7.4 exists for exactly this moment. A disappointing spike is a **pivot**, and the pivot is already designed: tool selection moves out of the model and into the UI, the user taps one of a fixed set of questions, and the model's only job is to narrate a supplied tool result. *"The grounding check, the output guard, the session rules and the card degradation all work unchanged. It is a smaller feature, not a different one."*

So the verdict is one of three, and none of them is "stop":

| Verdict | Condition (spec §7.2 / §7.3) | Where it routes |
|---|---|---|
| **GO** | Grammars accepted and reliable (0/50 malformed); 4B strict tool-pick comfortably above 70%; 1.7B resident through an app switch; tok/s within the §2.1 bands | `2026-08-20-on-device-ai-assistant.md` as written. Every gated phase unblocks. |
| **RESHAPE** | Any single §7.3 row fires — GBNF unreliable, 4B decode below ~3 tok/s, 1.7B evicted on 6 GB, APK delta over ~40 MB, thinking unsuppressible | The same plan, with the named phases rewritten against the finding. The §7.3 table already says what each rewrite is. **This is the common case and it is not a setback.** |
| **FALLBACK** | 4B strict tool-pick **below ~70%** | Spec §7.4's design. The implementation plan's Phase 3 (grammar), Phase 7 (dispatch loop) and Phase 10 (chat surface) are replaced by a fixed question list and a narrate-only prompt. Phases 1, 2, 4, 5, 6, 8 and 11 survive **unchanged** — that is roughly two thirds of the plan, and it is why this is a pivot. |

- [ ] **Step 1: Fill in the verdict section**

Append to the findings doc:

```markdown
---

## Verdict

**Date:** 2026-__-__   **Decided by:** ____

| §7.2 criterion | Target | Measured | Met? |
|---|---|---|---|
| Grammars accepted per request | yes | | |
| Malformed outputs in 50 constrained generations | 0 | | |
| 4B strict tool-pick | comfortably > 70% (≥ 9/12) | | |
| 1.7B resident through an app switch | yes, on the available variant | | |
| tok/s within §2.1's estimated bands | 0.6B 25–45 · 1.7B-Q4 12–20 · 4B-Q4 5–9 | | |

**Verdict: GO / RESHAPE / FALLBACK**

**If RESHAPE — which §7.3 rows fired, and what each rewrites:**
____

**If FALLBACK — confirm the §7.4 scope explicitly:**
- [ ] Fixed question list replaces model-side tool selection
- [ ] Model narrates a supplied tool result only
- [ ] Grounding check (§3.5): **unchanged**
- [ ] Output guard (§4.4): **unchanged**
- [ ] Session rules (§4.5–4.6): **unchanged**
- [ ] Card degradation (§4.8): **unchanged**
- [ ] Implementation plan phases 1, 2, 4, 5, 6, 8, 11: **unchanged**

**Corrections to the spec that these numbers require:**
| Spec location | Says | Should say |
|---|---|---|
| §2.1 tok/s column | estimates | ____ |
| §2.1 minRamBytes basis | unstated | Task 7's PSS table |
| §2.1 tier list | five tiers | ____ (tiers cut on hardware grounds per §5.5's "the spike cuts before anything ships") |

**Amendments this unblocks or blocks:**
See `docs/superpowers/plans/2026-08-20-on-device-ai-doc-amendments.md` Task 3 — the
Plus → Free move for AI insights is **sequenced behind the tier-1 tool-pick number in §5 above**,
because the free tier's differentiator cannot be a documented promise the 0.4 GB model does not
keep (§6 risks 1 and 7).
```

- [ ] **Step 2: Point the on-device record at the findings**

Append to `docs/13-on-device-verification.md`'s "What is already proven" table:

```markdown
| llama.rn spike (AI spec §7) | Run 2026-__-__ on the A54. Verdict **____**. Numbers, and the corrections they force on AI spec §2.1, in `docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md`. The §5.6 gate list is **not** discharged by this — the spike proves the runtime, the gates prove the shipped feature. |
```

- [ ] **Step 3: Get the findings onto the mainline without the spike app**

The findings doc and the two `docs/` edits are the only things that leave this branch. Author them on the mainline branch directly, or cherry-pick only the doc commits:

```bash
git switch feat/mvp-implementation
git cherry-pick <sha-of-task-2-commit> <sha-of-task-11-commit> <sha-of-task-12-commit>
```

**Do not merge `spike/llama-rn-probe`.** The branch stays for as long as anyone wants to re-run a measurement, then it is deleted. Nothing in `mobile/` ever references it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-2X-llama-rn-spike-findings.md docs/13-on-device-verification.md
git commit -m "docs: record the llama.rn spike verdict and its consequences for the AI design"
```

---

## Self-review against spec §7

| §7 requirement | Task |
|---|---|
| §7.1 q1 — loads a Qwen3 GGUF and streams; TTFT and tok/s | Task 4 |
| §7.1 q2 — GBNF per request, 50 generations, zero malformed | Task 5 |
| §7.1 q3 — thinking suppression, and whether it moves TTFT | Task 6 |
| §7.1 q4 — peak RSS at three sizes, app-switch survival | Task 7 |
| §7.1 q5 — 12-question strict tool-pick at three sizes | Task 8 |
| §7.1 q6 — APK delta, arm64-only | Task 9 |
| §7.1 q7 — `Device.totalMemory` vs `/proc/meminfo` | Task 9 (and Task 1 supplies the comparison) |
| §7.2 — what a "go" looks like | Task 12's criteria table |
| §7.3 — what would kill or reshape | Task 12's verdict routing |
| §7.4 — the named fallback | Task 12's FALLBACK checklist, with the unchanged-phase list |
| §6 risk 2 — A54 variant, unmeasured half recorded as unknown | Task 1 |
| §6 risk 8 — streaming SHA-256 | Task 10 |
| §6 risk 10 — cold reload | Task 10 |
| §2.1 / §8.4 — licence re-verification, given an owner | Task 2 |
| §5.6 gate 5 — thermal | Task 11 |

**Not in this plan, deliberately:** §5.6 gates 6 (a real download over a Philippine mobile network), 8 (decode off the JS thread), 9 (does streaming read as alive), and 10 (storage and backup exclusion). All four test the *shipped* feature rather than the runtime, and all four need code this spike does not have. They belong to the implementation plan's Phase 11 and are listed there.
