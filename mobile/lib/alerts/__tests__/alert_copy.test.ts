// lib/alerts/__tests__/alert_copy.test.ts — docs/12-encryption-and-app-lock.md
// §7a; task-9b-brief. The keyguard is checked at POST time
// (`selectAlertCopy(copy, await isKeyguardLocked())`, contract §4/§10) —
// this file only covers the copy catalogue and the pure selector; the
// native `isKeyguardLocked()` bridge itself is covered by
// modules/notification_listener/__tests__/index.test.ts.
//
// The test that matters most is "leaks no amount locked" below: it scans
// EVERY entry in ALERT_COPY_CATALOGUE programmatically rather than
// hand-checking each one, so a twelfth alert added next year cannot quietly
// slip a peso figure into copy the lock screen renders.
import {
  ALERT_COPY_CATALOGUE,
  billDueAlertCopy,
  limitThresholdAlertCopy,
  loanReminderAlertCopy,
  paydaySummaryAlertCopy,
  selectAlertCopy,
  trackingInterruptedAlertCopy,
  type AlertCopy,
} from "../alert_copy";

/**
 * True if `text` carries a peso sign, or any digit sequence not accounted
 * for by one of the two figure-free categories docs §7a's own canonical
 * examples use: a percentage ("80%") or a day count ("3 days"). Anything
 * else numeric — an amount, a balance, a bare figure with no sign — is
 * exactly what a locked-screen alert must never carry.
 */
function looksLikeAnAmount(text: string): boolean {
  if (text.includes("₱")) return true;
  const withAllowedNumbersRemoved = text
    .replace(/\b\d+%/g, "")
    .replace(/\b\d+\s+days?\b/gi, "");
  return /\d/.test(withAllowedNumbersRemoved);
}

describe("selectAlertCopy", () => {
  const copy: AlertCopy = {
    locked: { title: "locked title", body: "locked body" },
    unlocked: { title: "unlocked title", body: "unlocked body" },
  };

  it("returns the locked variant when the keyguard is on", () => {
    expect(selectAlertCopy(copy, true)).toEqual(copy.locked);
  });

  it("returns the unlocked variant when the keyguard is off", () => {
    expect(selectAlertCopy(copy, false)).toEqual(copy.unlocked);
  });
});

describe("ALERT_COPY_CATALOGUE", () => {
  it("is not empty — an empty catalogue would make every assertion below vacuously true", () => {
    expect(ALERT_COPY_CATALOGUE.length).toBeGreaterThan(0);
  });

  it.each(ALERT_COPY_CATALOGUE.map((entry) => [entry.name, entry.copy] as const))(
    "%s: the locked variant contains no ₱ character and no digit sequence that could be an amount",
    (_name, copy) => {
      expect(looksLikeAnAmount(copy.locked.title)).toBe(false);
      expect(looksLikeAnAmount(copy.locked.body)).toBe(false);
    },
  );

  it.each(ALERT_COPY_CATALOGUE.map((entry) => [entry.name, entry.copy] as const))(
    "%s: supplies both a locked and an unlocked variant, each with a non-empty title and body",
    (_name, copy) => {
      for (const variant of [copy.locked, copy.unlocked]) {
        expect(variant.title.length).toBeGreaterThan(0);
        expect(variant.body.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(ALERT_COPY_CATALOGUE.map((entry) => [entry.name, entry.copy] as const))(
    "%s: the locked variant is non-empty and differs from its unlocked sibling",
    (_name, copy) => {
      expect(copy.locked.title.length + copy.locked.body.length).toBeGreaterThan(0);
      expect(copy.locked).not.toEqual(copy.unlocked);
    },
  );
});

// ---------------------------------------------------------------------------
// The individual builder functions — what M2/M2b/M2c/M3 actually call to get
// an AlertCopy for their own alert, before selecting a variant with
// selectAlertCopy(copy, await isKeyguardLocked()) at post time.
// ---------------------------------------------------------------------------

describe("limitThresholdAlertCopy", () => {
  it("keeps the amount and balance out of the locked variant, but includes them unlocked", () => {
    const copy = limitThresholdAlertCopy({ threshold: 80, scope: "monthly", spent: 840000, limit: 1000000 });

    expect(copy.locked.body).toBe("You've reached 80% of your monthly limit.");
    expect(copy.unlocked.body).toBe("You've spent ₱8,400 of your ₱10,000 monthly limit.");
  });
});

describe("billDueAlertCopy", () => {
  it("includes the user-chosen bill name in the locked variant, but withholds the amount", () => {
    const copy = billDueAlertCopy({ billName: "Meralco", daysUntilDue: 3, amount: 210000 });

    expect(copy.locked.body).toBe("Meralco is due in 3 days.");
    expect(copy.unlocked.body).toBe("Meralco, around ₱2,100, is due in 3 days.");
  });
});

describe("loanReminderAlertCopy", () => {
  it("withholds the counterparty's name from the locked variant — unlike a bill name, a counterparty is never allowed locked", () => {
    const copy = loanReminderAlertCopy({
      direction: "i-owe",
      counterparty: "Aling Nena",
      daysUntilDue: 2,
      amount: 500000,
    });

    expect(copy.locked.title).not.toContain("Aling Nena");
    expect(copy.locked.body).not.toContain("Aling Nena");
    expect(copy.unlocked.body).toContain("Aling Nena");
  });

  it("distinguishes i-owe from owed-to-me in both variants", () => {
    const iOwe = loanReminderAlertCopy({ direction: "i-owe", counterparty: "A", daysUntilDue: 1, amount: 100 });
    const owedToMe = loanReminderAlertCopy({ direction: "owed-to-me", counterparty: "A", daysUntilDue: 1, amount: 100 });

    expect(iOwe.locked.body).not.toBe(owedToMe.locked.body);
    expect(iOwe.unlocked.body).not.toBe(owedToMe.unlocked.body);
  });
});

describe("paydaySummaryAlertCopy", () => {
  it("stays actionable locked without the amount", () => {
    const copy = paydaySummaryAlertCopy({ amount: 3500000 });

    expect(copy.locked.body.length).toBeGreaterThan(0);
    expect(copy.locked.body).not.toContain("₱");
    expect(copy.unlocked.body).toContain("₱");
  });
});

describe("trackingInterruptedAlertCopy", () => {
  it("stays actionable locked with nothing financial, even a bare count", () => {
    const copy = trackingInterruptedAlertCopy({ pendingCount: 4 });

    expect(copy.locked.body.length).toBeGreaterThan(0);
    expect(looksLikeAnAmount(copy.locked.body)).toBe(false);
    expect(copy.unlocked.body).toContain("4");
  });
});
