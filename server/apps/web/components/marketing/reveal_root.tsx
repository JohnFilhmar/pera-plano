"use client";

import { useEffect } from "react";

/**
 * One observer for the whole page rather than a wrapper component per revealed element.
 *
 * The wrapper approach costs a <div> around every card, which is exactly the thing that
 * breaks a grid: a persona card wrapped in a motion div is no longer a grid item, it is a
 * grid item containing a card. Server components mark themselves with a plain `data-reveal`
 * attribute, this mounts once, and nothing in the markup changes shape.
 *
 * The hidden state lives in globals.css behind `:root[data-js]`, so if this never mounts —
 * scripting off, hydration failed, a crawler — every element is already visible.
 */
export function RevealRoot() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (nodes.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      for (const node of nodes) node.dataset.reveal = "in";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "in";
          observer.unobserve(entry.target);
        }
      },
      // Fires a little before the element is fully on screen, so the transition finishes
      // roughly as it settles rather than starting once the reader is already looking at it.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );

    for (const node of nodes) observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);

  return null;
}
