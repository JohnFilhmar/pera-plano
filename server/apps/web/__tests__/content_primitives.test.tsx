import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "@/components/content/data_table.js";
import { ServiceStatusNotice } from "@/components/content/service_status_notice.js";
import { getMessages } from "@/messages/index.js";

describe("DataTable", () => {
  it("tags the table with the id the drift test looks for", () => {
    const html = renderToStaticMarkup(
      <DataTable id="lifecycle" caption="c" headers={["a", "b"]} rows={[["1", "2"]]} />,
    );
    expect(html).toContain('data-table-id="lifecycle"');
  });

  it("wraps the table so a six-column prose table cannot make the page scroll sideways", () => {
    const html = renderToStaticMarkup(
      <DataTable id="x" caption="c" headers={["a"]} rows={[["1"]]} />,
    );
    expect(html).toContain("table-scroll");
  });

  it("renders every header and every cell", () => {
    const html = renderToStaticMarkup(
      <DataTable id="x" caption="c" headers={["H1", "H2"]} rows={[["r1c1", "r1c2"], ["r2c1", "r2c2"]]} />,
    );
    for (const text of ["H1", "H2", "r1c1", "r1c2", "r2c1", "r2c2"]) {
      expect(html).toContain(text);
    }
  });
});

describe("ServiceStatusNotice", () => {
  it("states plainly that there is no server-side copy", () => {
    const html = renderToStaticMarkup(<ServiceStatusNotice messages={getMessages("en")} />);
    expect(html).toContain("no copy on our servers");
  });
});
