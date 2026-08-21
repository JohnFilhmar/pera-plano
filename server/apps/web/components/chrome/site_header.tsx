import type { Locale, Messages } from "@/messages/index";
import { BrandMark } from "@/components/content/brand_mark";
import { ThemeToggle } from "./theme_toggle";
import styles from "./site_header.module.css";

/**
 * The six pages, in one place, so the header and footer (which repeats this list —
 * see site_footer.tsx) cannot silently drift onto different route lists.
 */
export const NAV_ITEMS = [
  { path: "", labelKey: "home" },
  { path: "/support", labelKey: "support" },
  { path: "/privacy", labelKey: "privacy" },
  { path: "/terms", labelKey: "terms" },
  { path: "/installed-apps", labelKey: "installedApps" },
  { path: "/data-deletion", labelKey: "dataDeletion" },
] as const satisfies readonly { path: string; labelKey: keyof Messages["nav"] }[];

export function SiteHeader({
  messages,
  locale,
  localeCount,
}: {
  messages: Messages;
  locale: Locale;
  localeCount: number;
}) {
  return (
    <>
      {/* First focusable element on every page, per WCAG 2.4.1 — a compliance site is
          exactly the kind of site a screen-reader or keyboard user needs to navigate. */}
      <a className="skip-link" href="#content">
        {messages.nav.skipToContent}
      </a>
      <header className={styles.header}>
        <div className={styles.inner}>
          <a className={styles.brand} href={`/${locale}`}>
            <BrandMark size={26} />
            <span>{messages.meta.siteName}</span>
          </a>
          <nav className={styles.nav} aria-label={messages.meta.siteName}>
            {NAV_ITEMS.map((item) => (
              <a key={item.path} href={`/${locale}${item.path}`}>
                {messages.nav[item.labelKey]}
              </a>
            ))}
          </nav>
          <div className={styles.actions}>
            {/* One locale ships today (Task 4's brief). A switcher with a single option
                is not a control, it is decoration — render nothing until it does something. */}
            {localeCount > 1 && (
              <div data-language-switcher>{messages.meta.localeLabel}</div>
            )}
            <ThemeToggle label={messages.nav.toggleTheme} />
          </div>
        </div>
      </header>
    </>
  );
}
