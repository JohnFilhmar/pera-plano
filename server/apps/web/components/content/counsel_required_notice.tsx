import type { Messages } from "@/messages/index";
import { Callout } from "./callout";

export function CounselRequiredNotice({ messages }: { messages: Messages }) {
  const { heading, intro, clauses, consequence } = messages.counselRequired;
  return (
    <Callout tone="warn" heading={heading}>
      <p>{intro}</p>
      <ul>
        {clauses.map((clause, index) => (
          <li key={`counsel-clause-${String(index)}`}>{clause}</li>
        ))}
      </ul>
      <p>{consequence}</p>
    </Callout>
  );
}
