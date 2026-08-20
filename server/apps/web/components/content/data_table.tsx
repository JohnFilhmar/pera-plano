import styles from "./data_table.module.css";

export function DataTable({
  id,
  caption,
  headers,
  rows,
}: {
  id: string;
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    // data-table-id is how the §4 drift test finds this table in the rendered HTML.
    // Renaming it silently disables the test that keeps the notice honest.
    <div className={`table-scroll ${styles.wrap}`}>
      <table data-table-id={id}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.join("|") + String(rowIndex)}>
              {row.map((cell, cellIndex) => (
                <td key={`${String(rowIndex)}-${String(cellIndex)}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
