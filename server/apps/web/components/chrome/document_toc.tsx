"use client";

import { useEffect, useState } from "react";
import styles from "./document_shell.module.css";

interface Entry {
  readonly id: string;
  readonly label: string;
}

/**
 * The contents list for the five document pages, built by reading the page's own headings
 * rather than from a list each page has to maintain.
 *
 * That is deliberate, and it is the difference between this shipping and not. The
 * alternative — a `sections` prop threaded through five page components — is a second copy
 * of the section list that drifts from the first, and /privacy already has a drift test
 * precisely because that failure mode is expensive here. Reading `section[id] > h2` from the
 * rendered document means the contents cannot disagree with the page.
 *
 * It renders nothing on the server and nothing without JavaScript, which is correct: it is
 * navigation for a document that is already complete and already linkable by anchor.
 */
export function DocumentToc({ label }: { label: string }) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const headings = Array.from(
      document.querySelectorAll<HTMLHeadingElement>("main article section[id] > h2"),
    );
    const found = headings
      .map((heading) => ({
        id: heading.parentElement?.id ?? "",
        label: heading.textContent?.trim() ?? "",
      }))
      .filter((entry) => entry.id !== "" && entry.label !== "");

    // One or two headings is a list nobody needs; below three it is chrome for its own sake.
    if (found.length < 3) return;
    setEntries(found);

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible !== undefined) setActive(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const heading of headings) {
      const parent = heading.parentElement;
      if (parent !== null) observer.observe(parent);
    }
    return () => { observer.disconnect(); };
  }, []);

  if (entries.length === 0) return null;

  return (
    <nav className={styles.toc} aria-label={label}>
      <p className={styles.tocLabel}>{label}</p>
      <ol className={styles.tocList}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`} data-active={entry.id === active}>
              {entry.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
