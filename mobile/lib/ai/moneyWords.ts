// mobile/lib/ai/moneyWords.ts
//
// LEVEL 5 ONLY. Assistant levels spec §3: at level 5 a "should I" question
// reaches the model unless it is about money, and the advice-wording guard
// fires only on money. This list is how "about money" is decided.
//
// FALSE POSITIVES ARE THE SAFE DIRECTION. "Mahal" also means "dear" and
// "interest" is also a hobby, so a harmless question can get the redirect. It
// costs an answer, never a wrong one. FALSE NEGATIVES ARE THE ACCEPTED RISK:
// "should I get the new iPhone?" has no money word and reaches the model. The
// owner accepted that on 2026-09-25, behind level 5's read-and-accept notice.
//
// THE LIST IS DATA, like the triage rows: a money question seen slipping past
// on a real device becomes a word here and a case in the test, in the same
// commit.
import { normalise } from "./normalise";

const MONEY_WORDS: readonly string[] = [
  "money", "pera", "peso", "pesos", "php",
  "buy", "bought", "buys", "buying", "purchase", "bili", "bumili", "bilhin", "afford",
  "spend", "spent", "spends", "spending", "gastos", "gumastos", "gastusin",
  "save", "saves", "saving", "savings", "ipon", "mag-ipon",
  "invest", "invests", "investing", "invested", "investment", "investments", "stock", "stocks", "crypto", "bitcoin", "fund",
  "loan", "loans", "utang", "borrow", "lend", "pautang", "debt", "debts", "credit", "card",
  "bank", "bangko", "pay", "pays", "paying", "paid", "payment", "bayad", "magbayad", "bayaran", "binayaran",
  "price", "prices", "priced", "presyo", "cost", "costs", "costly", "cheaper", "halaga", "budget", "budgets", "budgeting",
  "salary", "salaries", "sweldo", "sahod", "income", "kita",
  "rent", "upa", "insurance", "interest", "tax", "taxes", "buwis", "bill", "bills", "fee", "fees",
  "expensive", "expense", "expenses", "mahal", "cheap", "mura", "sale", "sales", "discount", "discounts",
  "wallet", "wallets", "balance", "balances", "account", "accounts", "cash",
  "transfer", "transfers", "withdraw", "withdrawal", "gcash", "maya",
];

const MONEY_PATTERN = new RegExp(`\\b(?:${MONEY_WORDS.join("|")})\\b`);

/**
 * Whether a message or an answer is about money, for level 5's two checks.
 *
 * @param text - Raw text. The peso sign is checked before normalising drops it.
 * @returns True when the text holds a peso sign or any word on the money list.
 */
export function mentionsMoney(text: string): boolean {
  return text.includes("₱") || MONEY_PATTERN.test(normalise(text));
}
