"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./nav_menu.module.css";

/**
 * The header navigation: a row on wide screens, a disclosure behind a menu button on a
 * phone.
 *
 * The links are NOT built here. SiteHeader renders them from NAV_ITEMS on the server and
 * passes them in as children, so all six anchors are in the served HTML whether or not this
 * component ever hydrates — which is what the header test asserts, and what a crawler reads.
 *
 * Without JavaScript the button is never shown and the panel is never collapsed: the hidden
 * state is gated on `:root[data-js]` in the stylesheet, exactly like the scroll reveals, so
 * a reader with scripting off gets the plain wrapped row rather than a button that does
 * nothing. That is the whole reason this is CSS-gated rather than conditionally rendered.
 */
export function NavMenu({
  label,
  openLabel,
  closeLabel,
  children,
}: {
  label: string;
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Focus goes back to the control that opened the panel, not to the top of the
      // document — losing your place is the usual way a menu becomes unusable by keyboard.
      buttonRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) === true) return;
      if (buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // A panel left open while the viewport grows would sit there as a floating card over a
  // layout that already shows the same links inline.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 52rem)");
    const sync = () => { if (wide.matches) setOpen(false); };
    sync();
    wide.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); };
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => { setOpen((value) => !value); }}
      >
        <span className={styles.bars} data-open={open} aria-hidden="true" />
        <span className={styles.buttonLabel}>{open ? closeLabel : openLabel}</span>
      </button>

      <nav
        ref={panelRef}
        id="site-nav"
        className={styles.nav}
        aria-label={label}
        data-open={open}
        // Any anchor in here navigates, so the panel has no reason to stay open behind the
        // page that is already loading. One handler on the container rather than one per
        // link, because the links are children this component does not own.
        onClick={() => { setOpen(false); }}
      >
        {children}
      </nav>
    </>
  );
}
