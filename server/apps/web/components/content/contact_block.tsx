import styles from "./contact_block.module.css";

export function ContactBlock({
  heading,
  lines,
  mailto,
}: {
  heading: string;
  lines: readonly string[];
  mailto?: string;
}) {
  return (
    <div className={styles.block}>
      <h3>{heading}</h3>
      {lines.map((line, index) => {
        const isLastLine = index === lines.length - 1;
        return (
          <p key={`${heading}-${String(index)}`}>
            {isLastLine && mailto !== undefined ? <a href={`mailto:${mailto}`}>{line}</a> : line}
          </p>
        );
      })}
    </div>
  );
}
