import type { ReactNode } from "react";
import { NavGlyph } from "@/components/marketing/nav_glyph";
import type { Locale, Messages } from "@/messages/index";
import { NAV_ITEMS } from "./site_header";
import { DocumentToc } from "./document_toc";
import styles from "./document_shell.module.css";

/**
 * The five pages that are not the marketing page are documents: a privacy notice, terms,
 * support, and the two surfaces Google Play requires. They stay documents — this shell adds
 * navigation around them and changes nothing inside them.
 *
 * That boundary is the point. The page components keep rendering their own <h1>, their own
 * sections and their own ids, so the content contract in __tests__ (the /privacy RA 10173
 * drift test above all) is untouched by anything here. What this adds is a contents list
 * built from the page's own headings, a pager along the same NAV_ITEMS order the header and
 * footer use, and — on the two Play-required pages — one sentence saying why the page is
 * there at all. docs/14-design-revamp-prompt.md §2.1 asks for exactly that: they "need to
 * look deliberate rather than like leftovers".
 *
 * No motion. A clause body is not a place for a reveal.
 */
export function DocumentShell({
  messages,
  locale,
  path,
  children,
}: {
  messages: Messages;
  locale: Locale;
  /** The route's own path as it appears in NAV_ITEMS, e.g. "/support". */
  path: string;
  children: ReactNode;
}) {
  const { document: doc } = messages;
  const key = path.replace(/^\//, "");
  const note = key in doc.notes ? doc.notes[key as keyof typeof doc.notes] : undefined;

  const index = NAV_ITEMS.findIndex((item) => item.path === path);
  const previous = index > 0 ? NAV_ITEMS[index - 1] : undefined;
  const next = index >= 0 && index < NAV_ITEMS.length - 1 ? NAV_ITEMS[index + 1] : undefined;

  return (
    <div className={styles.shell}>
      <aside className={styles.aside}>
        <DocumentToc label={doc.contentsLabel} />
      </aside>

      <div className={styles.body}>
        {/* A strip, not a Callout. It sits above the page's own <h1>, and a full mint panel
            there outweighs the title and inverts the hierarchy — the reader meets a box
            before they meet the page. Kept at the weight of a system note, which is what it
            is: the reason a compliance surface exists, stated once. */}
        {note !== undefined ? (
          <aside className={styles.note}>
            <strong>{note.heading}</strong>
            <p>{note.body}</p>
          </aside>
        ) : null}

        {children}

        {/* Its own label, not the contents list's: two <nav> landmarks sharing one name is
            an unresolvable choice for anyone navigating by landmark. */}
        <nav className={styles.pager} aria-label={doc.pagerLabel}>
          {previous !== undefined ? (
            <a className={styles.pagerLink} href={`/${locale}${previous.path}`} data-side="previous">
              <NavGlyph direction="w" size={22} />
              <span>
                <span className={styles.pagerKicker}>{doc.previousLabel}</span>
                {messages.nav[previous.labelKey]}
              </span>
            </a>
          ) : (
            <span />
          )}
          {next !== undefined ? (
            <a className={styles.pagerLink} href={`/${locale}${next.path}`} data-side="next">
              <span>
                <span className={styles.pagerKicker}>{doc.nextLabel}</span>
                {messages.nav[next.labelKey]}
              </span>
              <NavGlyph direction="e" size={22} />
            </a>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  );
}
