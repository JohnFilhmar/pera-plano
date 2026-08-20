import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./callout.module.css";

const TONE_CLASS = {
  info: styles.info,
  warn: styles.warn,
  danger: styles.danger,
} as const;

/**
 * `...rest` forwards to the root <aside> (excluding className/children, which this
 * component owns). This is how ServiceStatusNotice attaches `data-service-status`
 * without a one-off variant — the three required props stay exactly as documented.
 */
type CalloutProps = {
  tone: "info" | "warn" | "danger";
  heading: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"aside">, "className" | "children">;

export function Callout({ tone, heading, children, ...rest }: CalloutProps) {
  return (
    <aside className={`${styles.callout} ${TONE_CLASS[tone]}`} {...rest}>
      <h3 className={styles.heading}>{heading}</h3>
      {children}
    </aside>
  );
}
