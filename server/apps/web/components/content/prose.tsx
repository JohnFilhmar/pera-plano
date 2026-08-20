import styles from "./prose.module.css";

export interface Section {
  /**
   * Anchor for the section element. A compliance notice is read by people who were sent
   * to one clause of it, and the /privacy drift test locates each required RA 10173
   * heading by this id — so the anchor belongs on the real <section>, not on a wrapper.
   */
  readonly id?: string;
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
}

export function Prose({ sections }: { sections: readonly Section[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.heading} id={section.id} className={styles.section}>
          <h2>{section.heading}</h2>
          {section.paragraphs?.map((paragraph, index) => (
            <p key={`${section.heading}-p-${String(index)}`}>{paragraph}</p>
          ))}
          {section.bullets !== undefined && section.bullets.length > 0 && (
            <ul>
              {section.bullets.map((bullet, index) => (
                <li key={`${section.heading}-b-${String(index)}`}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
