import type { AppConfig } from "@peraplano/common";
import { SERVICE_CAPABILITIES } from "@peraplano/common";
import { Callout } from "@/components/content/callout";
import { ContactBlock } from "@/components/content/contact_block";
import { DataTable } from "@/components/content/data_table";
import { Prose } from "@/components/content/prose";
import type { Messages } from "@/messages/index";
import styles from "./support_page.module.css";

/**
 * Spec §4.2. Two jobs: name a human to write to, and publish the complete list of things
 * the reader can do without writing to anyone. The second list is the one that answers a
 * Play reviewer asking "can the user turn this off?", which is why both tables are
 * reproduced in full rather than summarised.
 *
 * Every section cites the section of docs/07-privacy-and-compliance.md it derives from.
 * The four identity values come from AppConfig, never the catalog (spec §5).
 */
export function SupportPage({ messages, config }: { messages: Messages; config: AppConfig }) {
  const { support } = messages;
  const s = support.sections;
  const { contacts } = config;

  return (
    <article className={styles.page}>
      <h1>{support.title}</h1>

      <p className={styles.intro}>{support.intro}</p>

      {/* privacy §2.1 (who the controller is) and §2.4 (its identity and address belong
          in the notice; Play also wants a support contact on the listing). */}
      <section id="how-to-reach-us" className={styles.section}>
        <h2>{s.howToReachUs.heading}</h2>
        {s.howToReachUs.paragraphs.map((paragraph, index) => (
          <p key={`reach-${String(index)}`}>{paragraph}</p>
        ))}
        <div className={styles.contacts}>
          <ContactBlock
            heading={s.howToReachUs.supportHeading}
            lines={[contacts.SUPPORT_EMAIL]}
            mailto={contacts.SUPPORT_EMAIL}
          />
          <ContactBlock
            heading={s.howToReachUs.controllerHeading}
            lines={[contacts.PIC_LEGAL_NAME, contacts.PIC_ADDRESS]}
          />
        </div>
      </section>

      {/* privacy §2.3 (users are warned not to paste raw notification text) and §4 row 8
          (support mail is kept ≤ 24 months after case closure). The warning without the
          retention period does not explain itself, so both are here. */}
      <Prose sections={[{ id: "before-you-write", ...s.beforeYouWrite }]} />

      {/* privacy §7 lists cloud backup and sign-in identity deletion as controls, and
          SERVICE_CAPABILITIES says neither feature exists. Reproducing the table in full
          and saying so once is more honest than quietly dropping two rows — and the flags,
          not a hard-coded assumption, decide whether this block renders, so the day either
          ships the notice disappears with it. */}
      {SERVICE_CAPABILITIES.cloudBackup && SERVICE_CAPABILITIES.accounts ? null : (
        <Callout tone="info" heading={s.unshipped.heading}>
          <p>{s.unshipped.body}</p>
        </Callout>
      )}

      {/* privacy §7 — the complete user-controls list, all fourteen rows. */}
      <section id="controls" className={styles.section}>
        <h2>{s.controls.heading}</h2>
        <p>{s.controls.intro}</p>
        <DataTable
          id="controls"
          caption={s.controls.caption}
          headers={s.controls.headers}
          rows={s.controls.rows}
        />
      </section>

      {/* privacy §2.8 — the seven data-subject rights, each mapped to the control that
          delivers it rather than to a request form. */}
      <section id="rights" className={styles.section}>
        <h2>{s.rights.heading}</h2>
        <p>{s.rights.intro}</p>
        <DataTable
          id="rights"
          caption={s.rights.caption}
          headers={s.rights.headers}
          rows={s.rights.rows}
        />
      </section>

      {/* privacy §2.5 — the DPO is appointed before public launch; registration is a
          planning position deferred to counsel, so it is worded as one here too. */}
      <section id="dpo" className={styles.section}>
        <h2>{s.dpo.heading}</h2>
        {s.dpo.paragraphs.map((paragraph, index) => (
          <p key={`dpo-${String(index)}`}>{paragraph}</p>
        ))}
        <div className={styles.contacts}>
          <ContactBlock
            heading={s.dpo.dpoHeading}
            lines={[contacts.DPO_NAME, contacts.DPO_EMAIL]}
            mailto={contacts.DPO_EMAIL}
          />
          <ContactBlock heading={s.dpo.npcHeading} lines={[contacts.NPC_REGISTRATION]} />
        </div>
      </section>

      {/* privacy §2.4 (the notice must state the complaint route) and §2.8's last row.
          The Commission is named and nothing else: no repo document supplies a verified
          address or URL for it, and spec §4.0.1 forbids inventing one. */}
      <Prose sections={[{ id: "complaints", ...s.complaints }]} />
    </article>
  );
}
