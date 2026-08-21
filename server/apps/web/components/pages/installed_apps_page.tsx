import type { AppConfig } from "@peraplano/common";
import { Callout } from "@/components/content/callout";
import { Prose } from "@/components/content/prose";
import type { Messages } from "@/messages/index";
import styles from "./installed_apps_page.module.css";

/**
 * The disclosure page for installed-app discovery. It is deliberately narrow: it says
 * what is read, what is not, why, and — because the roadmap's own decision record says so
 * — that Google may refuse the declaration this depends on. A page written as though the
 * permitted use were settled would be contradicted by the document it derives from, which
 * is a worse position at review than conceding the ambiguity first.
 */
export function InstalledAppsPage({
  messages,
}: {
  messages: Messages;
  /**
   * Accepted so every page component has one signature that the route files and tests can
   * pass uniformly. This page renders no configured identity value, because it makes no
   * claim that depends on one — nothing here is a controller statement.
   */
  config: AppConfig;
}) {
  const { installedApps } = messages;
  const s = installedApps.sections;

  return (
    <article className={styles.page}>
      <h1>{installedApps.title}</h1>

      <p className={styles.intro}>{installedApps.intro}</p>

      {/* whatIsRead: roadmap §0.2 — the scan returns package names and nothing else.
          whatIsNeverRead: privacy §3.2, the permissions deliberately not requested, plus
          usage-access, which §3.2's reasoning covers but does not name.
          why: roadmap §0.2 (the picker must show apps the user demonstrably has) and §0.3
          (the thirteen guessed, unverified package names against an empty listener
          history, and why an empty selection only becomes a real choice after the scan). */}
      <Prose
        sections={[
          { id: "what-is-read", ...s.whatIsRead },
          { id: "what-is-never-read", ...s.whatIsNeverRead },
          { id: "why", ...s.why },
        ]}
      />

      {/* roadmap §0.2, near verbatim. The concession is a callout rather than a fourth
          paragraph because it is the one thing on this page a reviewer must not have to
          find: our own record says the enumerated permitted uses "do not obviously cover"
          this use and that "a rejection is a live possibility". Do not soften it, and do
          not add a sentence claiming Google has permitted or approved anything — the test
          in __tests__/installed_apps.test.tsx fails on both, on purpose. */}
      <section id="the-permission" className={styles.section}>
        <h2>{s.thePermission.heading}</h2>
        {s.thePermission.paragraphs.map((paragraph, index) => (
          <p key={`permission-${String(index)}`}>{paragraph}</p>
        ))}
        <Callout tone="warn" heading={s.thePermission.riskHeading}>
          <p>{s.thePermission.risk}</p>
        </Callout>
      </section>

      {/* theAlternative: roadmap §0.2's mitigation — one interface, two implementations —
          with the user-visible cost of the fallback stated rather than left as an
          engineering note.
          whereItGoes: this page states the handling on the plan's authority.
          docs/07-privacy-and-compliance.md §4 has no lifecycle row for installed-package
          enumeration yet; that gap is logged as an owner action against the compliance
          document, and is not fixed by editing the notice from here. */}
      <Prose
        sections={[
          { id: "the-alternative", ...s.theAlternative },
          { id: "where-it-goes", ...s.whereItGoes },
        ]}
      />
    </article>
  );
}
