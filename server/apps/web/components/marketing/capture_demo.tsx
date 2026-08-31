"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "motion/react";
import type { Messages } from "@/messages/index";
import styles from "./capture_demo.module.css";

type Demo = Messages["marketing"]["demo"];
type Sample = Demo["samples"][number];
type Stage = "arrives" | "parsing" | "settled" | "review";

/**
 * The page's signature, and the one thing on the site that is the product rather than a
 * description of it: a notification arrives, is taken apart on the device, and becomes a
 * ledger row without anyone typing. docs/14-design-revamp-prompt.md §6.3 asks for exactly
 * this — "a capture moment… It is the thing to sell" — and nothing animated it before.
 *
 * Three rules this component is built around.
 *
 * 1. THE SERVER RENDER IS THE FINAL FRAME, NOT THE FIRST. Initial state is `settled`, with
 *    every field, the ledger row and the amount already on screen. A reader without
 *    JavaScript gets a complete, legible diagram instead of an empty stage waiting for a
 *    timeline that will never run, and the hydrated markup matches byte for byte.
 * 2. EVERY PESO FIGURE ON THE PAGE LIVES INSIDE THIS ONE <figure data-illustrative>.
 *    marketing.test.tsx strips a single non-greedy figure match and then bans currency
 *    digits everywhere else, because the brief leaves pricing undecided. A second figure
 *    carrying an amount — or an amount rendered outside this one — fails that test, which
 *    is the intended behaviour and not a lint to route around.
 * 3. THE NOTIFICATIONS ARE INVENTED. The disclaimer sits above the sample rather than under
 *    it, so a reader who stops after the quote has already been told it is not a real bank
 *    message. That was true of the static <figure> this replaces and it stays true here.
 *
 * Motion timings are literals rather than a config object so they can be transcribed into a
 * `*_motion.ts` keyframe table for the phone under the §6.2 rule, if the mobile app ever
 * wants the same moment. react-native-svg cannot play any of this as authored.
 */
const STAGE_MS = { arrives: 1500, parsing: 1700, settled: 3600, review: 4200 } as const;

const FIELD_ORDER = ["amount", "direction", "merchant", "wallet", "category", "confidence"] as const;

export function CaptureDemo({ demo }: { demo: Demo }) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("settled");
  const [animate, setAnimate] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const sample = demo.samples[index] ?? demo.samples[0];
  if (sample === undefined) throw new Error("CaptureDemo: the demo catalog has no samples");

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const play = useCallback(
    (target: Sample) => {
      clearTimers();
      const end: Stage = target.outcome === "review" ? "review" : "settled";
      setStage("arrives");
      timers.current.push(setTimeout(() => { setStage("parsing"); }, STAGE_MS.arrives));
      timers.current.push(
        setTimeout(() => { setStage(end); }, STAGE_MS.arrives + STAGE_MS.parsing),
      );
    },
    [clearTimers],
  );

  // Reduced motion is a complete state here, not a degraded one: the stage stays `settled`,
  // every value is on screen, and the replay chips still switch samples instantly.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    setAnimate(true);
    play(sample);
    return clearTimers;
    // Deliberately mount-only, and deliberately not listing `sample` or `play`: re-running
    // this on a sample change would restart the timeline on every auto-advance, which is
    // already handled — on purpose, and in one place — by the advance effect below.
  }, []);

  // Auto-advance, but only once a cycle has actually finished, so a reader who picks a chip
  // is never interrupted mid-parse by the carousel moving on.
  useEffect(() => {
    if (!animate) return;
    if (stage !== "settled" && stage !== "review") return;
    const hold = stage === "review" ? STAGE_MS.review : STAGE_MS.settled;
    const timer = setTimeout(() => {
      const next = (index + 1) % demo.samples.length;
      setIndex(next);
      const upcoming = demo.samples[next];
      if (upcoming !== undefined) play(upcoming);
    }, hold);
    return () => { clearTimeout(timer); };
  }, [animate, stage, index, demo.samples, play]);

  const select = (next: number) => {
    setIndex(next);
    const target = demo.samples[next];
    if (target === undefined) return;
    if (animate) play(target);
    else setStage(target.outcome === "review" ? "review" : "settled");
  };

  const parsed = stage === "settled" || stage === "review";

  return (
    <figure data-illustrative className={styles.demo} data-stage={stage}>
      <figcaption className={styles.caption}>
        <strong>{demo.heading}</strong>
        <span className={styles.disclaimer}>{demo.disclaimer}</span>
      </figcaption>

      <LazyMotion features={domAnimation} strict>
        <div className={styles.stage}>
          <ol className={styles.rail} aria-hidden="true">
            <li data-active={stage === "arrives"}>{demo.stages.arrives}</li>
            <li data-active={stage === "parsing"}>{demo.stages.parses}</li>
            <li data-active={parsed}>
              {stage === "review" ? demo.stages.review : demo.stages.commits}
            </li>
          </ol>

          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={sample.id}
              className={styles.notification}
              initial={animate ? { opacity: 0, y: -18, scale: 0.97 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <span className={styles.notificationApp}>{sample.provider}</span>
              <p className={styles.notificationText}>{sample.notification}</p>
            </m.div>
          </AnimatePresence>

          <div className={styles.pipe} aria-hidden="true">
            {stage === "parsing" ? (
              /* eslint-disable-next-line @next/next/no-img-element -- SMIL, see nav_glyph */
              <img src="/brand/peraplano-idle-loop.svg" alt="" width={30} height={30} />
            ) : (
              <span className={styles.pipeLine} />
            )}
          </div>

          <ul className={styles.fields}>
            {FIELD_ORDER.map((field, position) => (
              <m.li
                key={field}
                className={styles.field}
                data-confidence={field === "confidence" ? sample.confidence.toLowerCase() : undefined}
                initial={false}
                animate={parsed ? { opacity: 1, y: 0 } : { opacity: 0.18, y: 6 }}
                transition={{ duration: 0.34, delay: parsed && animate ? position * 0.055 : 0 }}
              >
                <span className={styles.fieldLabel}>{demo.fieldLabels[field]}</span>
                <span className={`${styles.fieldValue} tabular`}>{sample[field]}</span>
              </m.li>
            ))}
          </ul>

          <div className={styles.ledger} data-direction={sample.direction.toLowerCase()}>
            <span className={styles.ledgerMerchant}>{sample.merchant}</span>
            <span className={styles.ledgerMeta}>
              {sample.wallet} · {sample.category}
            </span>
            <span className={`${styles.ledgerAmount} tabular`}>
              {sample.direction === "In" ? "+" : "−"}
              {sample.amount}
            </span>
            {stage === "settled" && animate ? (
              /* eslint-disable-next-line @next/next/no-img-element -- SMIL, see nav_glyph */
              <img
                key={`launch-${sample.id}`}
                className={styles.launch}
                src="/brand/peraplano-launch.svg"
                alt=""
                aria-hidden="true"
                width={26}
                height={26}
              />
            ) : null}
          </div>

          {sample.outcome === "review" ? (
            <div className={styles.review} data-open={stage === "review"}>
              <p className={styles.reviewPrompt}>{demo.reviewPrompt}</p>
              <div className={styles.reviewActions}>
                <span className={styles.reviewPrimary}>{demo.reviewConfirmLabel}</span>
                <span className={styles.reviewSecondary}>{demo.reviewAltLabel}</span>
              </div>
            </div>
          ) : null}

          <div className={styles.safe}>
            <span className={styles.safeLabel}>{demo.safeToSpendLabel}</span>
            <span className={`${styles.safeValue} tabular`}>
              {/* The struck-through figure only appears once there is a new one to compare
                  it against; showing it beside an identical number reads as a bug. */}
              {parsed ? <span className={styles.safeBefore}>{sample.safeBefore}</span> : null}
              {parsed ? sample.safeAfter : sample.safeBefore}
            </span>
          </div>

          <p className={styles.uploadNote}>{demo.uploadNote}</p>
        </div>
      </LazyMotion>

      <div className={styles.replay}>
        <span className={styles.replayLabel}>{demo.replayHeading}</span>
        {demo.samples.map((entry, position) => (
          <button
            key={entry.id}
            type="button"
            className={styles.chip}
            data-selected={position === index}
            aria-pressed={position === index}
            onClick={() => { select(position); }}
          >
            {entry.provider}
          </button>
        ))}
      </div>
    </figure>
  );
}
