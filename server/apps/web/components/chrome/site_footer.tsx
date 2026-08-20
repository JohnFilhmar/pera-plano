import type { Locale, Messages } from "@/messages/index";
import type { ComplianceContacts } from "@peraplano/common";
import { ContactBlock } from "@/components/content/contact_block";
import { NAV_ITEMS } from "./site_header";
import styles from "./site_footer.module.css";

interface FooterContact {
  readonly heading: string;
  readonly lines: readonly string[];
  readonly mailto?: string;
}

export function SiteFooter({
  messages,
  contacts,
  locale,
}: {
  messages: Messages;
  contacts: ComplianceContacts;
  locale: Locale;
}) {
  // Order matches privacy §2.4/§2.5's own controller → DPO → NPC → support sequence,
  // so a reader who just left that section finds the same order here.
  const contactBlocks: readonly FooterContact[] = [
    {
      heading: messages.footer.controllerHeading,
      lines: [contacts.PIC_LEGAL_NAME, contacts.PIC_ADDRESS],
    },
    {
      heading: messages.footer.dpoHeading,
      lines: [contacts.DPO_NAME, contacts.DPO_EMAIL],
      mailto: contacts.DPO_EMAIL,
    },
    {
      heading: messages.footer.npcHeading,
      lines: [contacts.NPC_REGISTRATION],
    },
    {
      heading: messages.footer.supportHeading,
      lines: [contacts.SUPPORT_EMAIL],
      mailto: contacts.SUPPORT_EMAIL,
    },
  ];

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav className={styles.nav} aria-label={messages.nav.home}>
          {NAV_ITEMS.map((item) => (
            <a key={item.path} href={`/${locale}${item.path}`}>
              {messages.nav[item.labelKey]}
            </a>
          ))}
        </nav>
        {/* ContactBlock, not a second hand-rolled copy of its markup. The duplicate that
            used to live here existed only because this file was written before the shared
            primitive was, and two renderers for the same four contact fields is exactly how
            the footer ends up disagreeing with the page above it. */}
        <div className={styles.contacts}>
          {contactBlocks.map((block) => (
            <ContactBlock
              key={block.heading}
              heading={block.heading}
              lines={block.lines}
              mailto={block.mailto}
            />
          ))}
        </div>
        <p className={styles.promise}>{messages.footer.promise}</p>
        <p className={styles.copyright}>{messages.footer.copyright}</p>
      </div>
    </footer>
  );
}
