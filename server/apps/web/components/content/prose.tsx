import styles from "./prose.module.css";

export interface Section {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
}

export function Prose({ sections }: { sections: readonly Section[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.heading} className={styles.section}>
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
