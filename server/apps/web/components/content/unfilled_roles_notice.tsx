import type { AppConfig } from "@peraplano/common";
import { ContactBlock } from "./contact_block";
import type { Messages } from "@/messages/index";
import styles from "./unfilled_roles_notice.module.css";

/**
 * The three compliance roles that do not exist yet, named on the page, plus one sentence
 * inviting someone qualified to fill one.
 *
 * Owner's ruling, 2026-08-21: this renders on `/` and `/support` and NOWHERE else. It is
 * deliberately kept off `/privacy` and out of the terms body — an RA 10173 notice that
 * also solicits business reads as unserious to the only two audiences those pages are
 * written for, a Play reviewer and the NPC. Both exclusions are asserted by tests
 * (`privacy_drift.test.tsx`, `terms.test.tsx`) rather than left to reviewer memory.
 *
 * One component and one catalog entry for both pages, on the same reasoning as
 * ServiceStatusNotice: two pages disagreeing about what a company is missing is exactly
 * the contradiction a regulator finds by reading both in one sitting. A byte-for-byte
 * equality test in `marketing.test.tsx` holds the two renders together.
 *
 * The address comes from AppConfig, never the catalog — so on a deployment with
 * SUPPORT_EMAIL unset this block invites people to write to a visible
 * `[ REQUIRED: SUPPORT_EMAIL ]` marker rather than to a plausible-looking dead mailbox.
 */
export function UnfilledRolesNotice({
  messages,
  config,
}: {
  messages: Messages;
  config: AppConfig;
}) {
  const { unfilledRoles } = messages;
  return (
    <section id="unfilled-roles" data-unfilled-roles className={styles.section}>
      <h2>{unfilledRoles.heading}</h2>
      {unfilledRoles.paragraphs.map((paragraph, index) => (
        <p key={`unfilled-roles-${String(index)}`}>{paragraph}</p>
      ))}
      <div className={styles.invitation}>
        <p>{unfilledRoles.invitation}</p>
        <ContactBlock
          heading={unfilledRoles.contactHeading}
          lines={[config.contacts.SUPPORT_EMAIL]}
          mailto={config.contacts.SUPPORT_EMAIL}
        />
      </div>
    </section>
  );
}
