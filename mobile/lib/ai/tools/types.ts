// mobile/lib/ai/tools/types.ts
//
// THE SHAPE THAT KEEPS THE MODEL AWAY FROM ARITHMETIC.
//
// `data` carries labels the model needs to write a sentence — category names,
// wallet names, states. `display` carries EVERY number and date the model is
// allowed to state, already formatted by `formatCentavos`. The model never
// formats currency and never does arithmetic, because it is never handed a
// figure it could do arithmetic on.
//
// AI spec §5.2/7: "The day someone adds `amount_centavos: 240000` 'for
// convenience' is the day the model starts doing arithmetic."
import type { EpochMs } from "@/types/domain";

export type DisplayKind = "amount" | "date" | "percent" | "count";

export type DisplayField = {
  key: string;
  /** Already formatted. This exact string is what grounding checks verbatim. */
  value: string;
  kind: DisplayKind;
};

export type ToolOk<T> = {
  ok: true;
  tool: string;
  data: T;
  display: DisplayField[];
};

/**
 * `locked` is not a failure mode, it is a REFUSAL, and it must never be
 * mistaken for an empty ledger. AI spec §3.6: an empty result is
 * indistinguishable from "you have no transactions", "and a model handed that
 * will cheerfully tell a locked user they have no money."
 */
export type ToolRefusalReason = "locked" | "unavailable" | "empty";

export type ToolRefusal = {
  ok: false;
  tool: string;
  reason: ToolRefusalReason;
  message: string;
};

export type ToolResult<T> = ToolOk<T> | ToolRefusal;

export type ToolHandler = (
  args: Record<string, unknown>,
  now: EpochMs,
) => Promise<ToolResult<unknown>>;

export function ok<T>(tool: string, data: T, display: DisplayField[]): ToolOk<T> {
  return { ok: true, tool, data, display };
}

export function locked(tool: string): ToolRefusal {
  return {
    ok: false,
    tool,
    reason: "locked",
    // Deliberately says nothing about the ledger's contents. The message
    // reaches the model, and "no data" would be a lie it would repeat.
    message: "The ledger is locked. Unlock the app to read it.",
  };
}

export function unavailable(tool: string, message: string): ToolRefusal {
  return { ok: false, tool, reason: "unavailable", message };
}

export function empty(tool: string, message: string): ToolRefusal {
  return { ok: false, tool, reason: "empty", message };
}

/** Rule 4's limit. Free text is a carrier; a short single line is a poor one. */
export const FREE_TEXT_MAX = 64;

/**
 * Merchant and wallet names are attacker-reachable: merchant names arrive from
 * notifications, and anyone can send the user a notification. AI spec §3.2:
 * "An injection needs room to work; a single-line 64-character field is a poor
 * carrier."
 *
 * Collapses ALL whitespace rather than only newlines — a run of spaces or a
 * tab is enough to lay out an instruction block, and no legitimate merchant
 * name needs one.
 */
export function safeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, FREE_TEXT_MAX);
}
