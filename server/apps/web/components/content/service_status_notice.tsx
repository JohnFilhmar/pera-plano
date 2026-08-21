import type { Messages } from "@/messages/index";
import { Callout } from "./callout";

export function ServiceStatusNotice({ messages }: { messages: Messages }) {
  const { heading, paragraphs } = messages.serviceStatus;
  return (
    // WHY: a later task's cross-page consistency test locates this notice on every page
    // by this attribute (see the Task 6 dispatch ruling) — it must be present from the
    // moment this component is written, not back-patched once that test exists.
    <Callout tone="info" heading={heading} data-service-status>
      {paragraphs.map((paragraph, index) => (
        <p key={`service-status-${String(index)}`}>{paragraph}</p>
      ))}
    </Callout>
  );
}
