import type { AppConfig } from "@peraplano/common";
import { SERVICE_CAPABILITIES } from "@peraplano/common";
import { Callout } from "@/components/content/callout";
import { ContactBlock } from "@/components/content/contact_block";
import { Prose } from "@/components/content/prose";
import { ServiceStatusNotice } from "@/components/content/service_status_notice";
import type { Messages } from "@/messages/index";
import styles from "./data_deletion_page.module.css";

/**
 * This is not an account-deletion endpoint, because there is no account and no server
 * copy of anything to delete. It is the set of on-device controls privacy §7 already
 * grants, written out for someone who arrived here from a store listing. Every section
 * cites the section of docs/07-privacy-and-compliance.md it derives from; the narrow
 * controls sit above the destructive ones deliberately, because a page that offers only
 * the hammer pushes a reader who wanted one record gone into uninstalling instead.
 */
export function DataDeletionPage({ messages, config }: { messages: Messages; config: AppConfig }) {
  const { dataDeletion } = messages;
  const s = dataDeletion.sections;
  const { contacts } = config;

  return (
    <article className={styles.page}>
      <h1>{dataDeletion.title}</h1>

      <p className={styles.intro}>{dataDeletion.intro}</p>

      {/* Task 9 review: this page restates two retention figures — the 30-day raw-text TTL
          and the 24-month support-mail window — from a document that is still a draft, while
          /privacy carries a status treatment and this page did not. The status string is
          substituted from privacy.sourceStatus rather than retyped, because that one key is
          bound to the document by __tests__/privacy_drift.test.tsx; a second literal here
          would be free to go stale on its own. */}
      <p className={styles.sourceNote}>
        {dataDeletion.sourceNote.replace("{status}", messages.privacy.sourceStatus)}
      </p>

      {/* The same component, from the same catalog entry, as /privacy. A cross-page test
          in __tests__/data_deletion.test.tsx compares the two rendered blocks, because two
          pages disagreeing about whether a server holds your ledger is exactly what a
          regulator finds by reading both in one sitting. Do not reword it here. */}
      <ServiceStatusNotice messages={messages} />

      {/* privacy §7: "Edit anything" and "Review Queue" (deleteOne); "Pause listening",
          "Pause per provider" and "Telemetry opt-out" (stopWithoutDeleting). */}
      <Prose
        sections={[
          { id: "delete-one", ...s.deleteOne },
          { id: "stop-without-deleting", ...s.stopWithoutDeleting },
        ]}
      />

      {/* privacy §7 "Wipe everything" for the in-app route; the other two are Android's
          own. §7's row also covers server copies "if backup was enabled" — omitted here
          because SERVICE_CAPABILITIES.cloudBackup is false, and describing a server-side
          deletion that cannot happen would imply a server-side copy that does not exist.
          It is stated in the conditional, once, in the last section. */}
      <section id="delete-everything" className={styles.section}>
        <h2>{s.deleteEverything.heading}</h2>
        <p>{s.deleteEverything.intro}</p>
        <ol className={styles.routes}>
          {s.deleteEverything.routes.map((route) => (
            <li key={route.action} className={styles.route}>
              <span className={styles.routeWhere}>{route.where}</span>
              <p className={styles.routeAction}>{route.action}</p>
              <p className={styles.routeDetail}>{route.detail}</p>
            </li>
          ))}
        </ol>
        <Callout tone="warn" heading={s.deleteEverything.recommendationHeading}>
          <p>{s.deleteEverything.recommendation}</p>
        </Callout>
      </section>

      {/* privacy §4 row 1 and lifecycle invariant 2: the 30-day purge of raw notification
          text happens whether or not the reader does anything, and the transparency screen
          says so once the text is gone. */}
      <Prose sections={[{ id: "self-deleting", ...s.selfDeleting }]} />

      {/* The beta signup list is the only thing this page can promise to delete that is not
          already on the reader's own phone, so it belongs here rather than as a footnote on
          /beta. Kept above "out of our reach" deliberately: this one IS in our reach. */}
      <Prose sections={[{ id: "remove-from-beta-list", ...s.removeFromBetaList }]} />

      {/* privacy §4 row 7 (exports leave the app's protection the moment they are written)
          and row 8 (support correspondence, ≤ 24 months after case closure). The support
          address comes from AppConfig, never from the catalog — "ask us" with no address
          is not a control, and a literal address here is how a wrong one gets published. */}
      <section id="out-of-our-reach" className={styles.section}>
        <h2>{s.outOfOurReach.heading}</h2>
        {s.outOfOurReach.paragraphs.map((paragraph, index) => (
          <p key={`out-of-reach-p-${String(index)}`}>{paragraph}</p>
        ))}
        <ul>
          {s.outOfOurReach.bullets.map((bullet, index) => (
            <li key={`out-of-reach-b-${String(index)}`}>{bullet}</li>
          ))}
        </ul>
        <div className={styles.contacts}>
          <ContactBlock
            heading={s.outOfOurReach.supportHeading}
            lines={[contacts.SUPPORT_EMAIL]}
            mailto={contacts.SUPPORT_EMAIL}
          />
        </div>
      </section>

      {/* privacy §3.7 — Play's account-deletion policy, written in the conditional because
          no sign-in identity exists. The capability flag, not a hard-coded assumption, is
          what selects this copy: the day `accounts` flips true this text is false, and the
          tripwire in libs/common/src/__tests__/capabilities.test.ts fails first and names
          the real deletion route as the work that must precede the flip. */}
      {SERVICE_CAPABILITIES.accounts ? null : (
        <Prose sections={[{ id: "if-accounts-ever-exist", ...s.ifAccountsEverExist }]} />
      )}
    </article>
  );
}
