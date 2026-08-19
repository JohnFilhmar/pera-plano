// components/ui/__tests__/no_numeric_keyboard.test.ts — numeric-input-system
// Task 15.
//
// THE GUARD THAT KEEPS THE OLD INPUT PATH DEAD. Tasks 1-14 moved every numeric
// and date field in the app onto the app-owned keypad
// (components/ui/numeric_field.tsx, components/ui/keypad_host.tsx,
// lib/money/peso_input.ts) and Task 15 deleted the inline numpad and helper
// they replaced (components/transactions/amount_numpad.tsx and
// centavosFromDigits in components/ui/amount_text.tsx). Nothing stops a future
// screen quietly bringing either back — a pasted TextInput with
// keyboardType="numeric", or a re-added AmountNumpad / centavosFromDigits call
// — except this test, which walks every .ts/.tsx file under mobile/ and fails
// if it finds one.
//
// MATCHES USAGE, NOT THE BARE NAME. Five files carry comment-only mentions of
// `AmountNumpad` or `centavosFromDigits` on purpose: they record why the old
// behaviour existed, which is exactly the history that stops someone
// reintroducing it (components/onboarding/income_quick_form.tsx,
// components/onboarding/__tests__/income_quick_form.test.tsx,
// lib/limits/limit_input.ts, lib/money/__tests__/peso_input.test.ts). A guard
// that greps for the bare string would delete that history to go green. This
// one matches a CALL, a JSX ELEMENT, or an IMPORT — none of which appear in
// prose — so the comments survive and reintroduced code does not.
import fs from "fs";
import path from "path";

const MOBILE_ROOT = path.resolve(__dirname, "../../..");

const SKIP_DIRS = new Set(["node_modules", ".expo", "android", "ios", ".git", "test_support"]);

// This file's own header and this list of patterns contain the very strings
// being searched for. Without excluding itself, it would report itself as an
// offender and could never go green.
const SELF = path.resolve(__filename);

type Check = { reason: string; pattern: RegExp };

const CHECKS: Check[] = [
  { reason: "calls centavosFromDigits(", pattern: /\bcentavosFromDigits\s*\(/gu },
  { reason: "renders <AmountNumpad", pattern: /<AmountNumpad\b/gu },
  {
    reason: "imports AmountNumpad or centavosFromDigits",
    // Brace-form named imports only — the one style this codebase uses for
    // both symbols. `[^}]*` spans a multi-line specifier list without a
    // dotAll flag, and stops at the import's own closing brace.
    pattern: /import\s+(?:type\s+)?\{[^}]*\b(?:centavosFromDigits|AmountNumpad)\b[^}]*\}\s*from\s*["'][^"']+["']/gu,
  },
  {
    reason: "asks for a numeric OS keyboard via keyboardType",
    pattern: /keyboardType\s*=\s*["'](?:numeric|number-pad|decimal-pad)["']/gu,
  },
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/u.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 1-based line number of `index` within `text`. */
function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

type Violation = { file: string; line: number; reason: string };

function findViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const file of collectSourceFiles(MOBILE_ROOT)) {
    if (path.resolve(file) === SELF) continue;

    const text = fs.readFileSync(file, "utf8");
    const relativePath = path.relative(MOBILE_ROOT, file);

    for (const { reason, pattern } of CHECKS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        violations.push({ file: relativePath, line: lineAt(text, match.index), reason });
        // Zero-width safety net: every pattern above consumes at least one
        // character, but guard against an infinite loop regardless.
        if (pattern.lastIndex === match.index) pattern.lastIndex++;
      }
    }
  }

  return violations;
}

test("no file outside the deleted numpad calls, renders, or imports the retired centavo-entry path, and no TextInput asks for a numeric OS keyboard", () => {
  const violations = findViolations();

  if (violations.length > 0) {
    const report = violations.map((v) => `  ${v.file}:${v.line} — ${v.reason}`).join("\n");
    throw new Error(`Found ${violations.length} violation(s) of the retired numeric input path:\n${report}`);
  }

  expect(violations).toEqual([]);
});
