"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pp-theme";

/**
 * The stored preference is applied by a blocking script in <head> (see app/layout.tsx),
 * not here — this component only flips it afterwards. Doing it in React alone would
 * paint the light theme first and then swap, which on a dark device reads as broken.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-browsing modes reject writes. The toggle still works for this page view;
      // losing the preference is not worth a thrown error on a compliance page.
    }
    setTheme(next);
  };

  return (
    <button type="button" onClick={flip} aria-label={label} data-theme-toggle>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
