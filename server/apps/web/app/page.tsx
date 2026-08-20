import { permanentRedirect } from "next/navigation";
import { SUPPORTED_LOCALES } from "@/messages/index";

// Permanent, not temporary: /en is the canonical home and a 307 would leave search
// engines and Play's crawler indexing a bare "/" that only ever bounces. `redirect()`
// issues a 307; `permanentRedirect()` is the 308 this comment (and Task 4 Step 7's
// curl check) actually requires.
export default function RootPage(): never {
  permanentRedirect(`/${SUPPORTED_LOCALES[0]}`);
}
