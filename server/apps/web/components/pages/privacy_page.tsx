import type { AppConfig } from "@peraplano/common";
import { Callout } from "@/components/content/callout";
import { ContactBlock } from "@/components/content/contact_block";
import { DataTable } from "@/components/content/data_table";
import { Prose } from "@/components/content/prose";
import { ServiceStatusNotice } from "@/components/content/service_status_notice";
import type { Messages } from "@/messages/index";
import styles from "./privacy_page.module.css";

/**
 * The RA 10173 Layer-2 notice (privacy §2.4). Every section below cites the section of
 * docs/07-privacy-and-compliance.md it derives from; nothing legal on this page is
 * written here for the first time. The three identity values are read from AppConfig
 * rather than the catalog, because a literal is how a plausible-but-false controller
 * name gets published (config/env.ts, spec §5).
 */
export function PrivacyPage({ messages, config }: { messages: Messages; config: AppConfig }) {
  const { privacy } = messages;
  const s = privacy.sections;
  const { contacts } = config;

  return (
    <article className={styles.page}>
      <h1>{privacy.title}</h1>

      {/* privacy §1 */}
      <p className={styles.intro}>{privacy.intro}</p>

      {/* privacy §2.5 defers final confirmation to Philippine counsel, and the source
          document is still a draft. The status string is substituted rather than typed
          into the sentence so the page cannot outlive the draft it derives from. */}
      <Callout tone="warn" heading={privacy.sourceHeading}>
        <p>{privacy.sourceNote.replace("{status}", privacy.sourceStatus)}</p>
      </Callout>

      {/* Spec §4.3 section 1. §4 rows 5 and 6 describe telemetry and cloud backup as
          things that exist; SERVICE_CAPABILITIES says neither runs. §2.4 binds the
          notice in both directions, so the table is published verbatim and this block
          states what is live. Identical on /data-deletion — do not reword it here. */}
      <ServiceStatusNotice messages={messages} />

      {/* privacy §2.1 (PIC/PIP roles), §2.4 (identity and DPO contact), §2.5 (DPO
          appointment and NPC registration). */}
      <section id="who-is-responsible" className={styles.section}>
        <h2>{s.whoIsResponsible.heading}</h2>
        {s.whoIsResponsible.paragraphs.map((paragraph, index) => (
          <p key={`responsible-${String(index)}`}>{paragraph}</p>
        ))}
        <div className={styles.contacts}>
          <ContactBlock
            heading={s.whoIsResponsible.controllerHeading}
            lines={[contacts.PIC_LEGAL_NAME, contacts.PIC_ADDRESS]}
          />
          <ContactBlock
            heading={s.whoIsResponsible.dpoHeading}
            lines={[contacts.DPO_NAME, contacts.DPO_EMAIL]}
            mailto={contacts.DPO_EMAIL}
          />
          <ContactBlock
            heading={s.whoIsResponsible.npcHeading}
            lines={[contacts.NPC_REGISTRATION]}
          />
        </div>
      </section>

      {/* privacy §2.3 — lawful basis per processing activity. */}
      <section id="why-we-process" className={styles.section}>
        <h2>{s.whyWeProcess.heading}</h2>
        <DataTable
          id="lawful-basis"
          caption={s.whyWeProcess.caption}
          headers={s.whyWeProcess.headers}
          rows={s.whyWeProcess.rows}
        />
      </section>

      {/* privacy §4 — the lifecycle table, published verbatim and bound to the source
          document by __tests__/privacy_drift.test.tsx. Rewriting a cell here without
          rewriting §4 (or the reverse) fails CI, which is the whole point: §2.4 says
          any change to §4 requires a notice revision in the same release. */}
      <section id="what-data-exists" className={styles.section}>
        <h2>{s.whatDataExists.heading}</h2>
        <p className={styles.note}>{s.whatDataExists.note}</p>
        <DataTable
          id="lifecycle"
          caption={s.whatDataExists.caption}
          headers={s.whatDataExists.headers}
          rows={s.whatDataExists.rows}
        />
        <h3>{s.whatDataExists.invariantsHeading}</h3>
        <ol>
          {s.whatDataExists.invariants.map((invariant, index) => (
            <li key={`invariant-${String(index)}`}>{invariant}</li>
          ))}
        </ol>
      </section>

      {/* privacy §5 (minimization), §2.4 (recipients), §2.4 and §2.8 (automated
          processing is user-correctable via the Review Queue). */}
      <Prose
        sections={[
          { id: "how-processing-happens", ...s.howProcessingHappens },
          // Placed before the recipients section, because the recipients section is where a
          // reader learns Google is involved and this is the only reason it is. Row 9 of the
          // lifecycle table above states the retention; this states the basis and purpose.
          { id: "beta-programme", ...s.betaProgramme },
          { id: "who-receives-it", ...s.whoReceivesIt },
          { id: "automated-decisions", ...s.automatedDecisions },
        ]}
      />

      {/* privacy §2.8 — data subject rights mapped to the control that delivers each. */}
      <section id="your-rights" className={styles.section}>
        <h2>{s.yourRights.heading}</h2>
        <DataTable
          id="rights"
          caption={s.yourRights.caption}
          headers={s.yourRights.headers}
          rows={s.yourRights.rows}
        />
      </section>

      {/* privacy §2.4 (the notice must state the complaint route) and §2.8's last row.
          The National Privacy Commission is named; no address, phone or URL is printed,
          because no repo document supplies one and inventing it is the failure mode
          this whole page is built to avoid (spec §4.0.1). */}
      <Prose sections={[{ id: "complaints", ...s.complaints }]} />

      {/* privacy §3.2 — permissions deliberately not requested. */}
      <section id="not-requested" className={styles.section}>
        <h2>{s.notRequested.heading}</h2>
        <DataTable
          id="permissions-not-requested"
          caption={s.notRequested.caption}
          headers={s.notRequested.headers}
          rows={s.notRequested.rows}
        />
      </section>

      {/* privacy §6 (third-party personal data inside notifications), §2.2 (why the whole
          ledger is protected at the sensitive-information bar) and §2.7 (breach posture:
          72 hours to the NPC and to the people affected). */}
      <Prose
        sections={[
          { id: "other-peoples-names", ...s.otherPeoplesNames },
          { id: "if-something-goes-wrong", ...s.ifSomethingGoesWrong },
        ]}
      />
    </article>
  );
}
