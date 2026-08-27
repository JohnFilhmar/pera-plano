// lib/wallets/__tests__/classification.test.ts — the rules that decide whether
// a wallet's balance is money the user HAS or money they OWE.
//
// This suite is the enforcement for the one inference in the app that can
// misstate the headline number: an owed wallet is excluded from the Wallets-tab
// total and from Safe-to-Spend, so a verdict that flips too easily inflates a
// budgeting app by the size of the user's debt. The hysteresis cases below are
// the point of the module, not decoration.
import {
  addEvidence,
  classifyOwed,
  EMPTY_EVIDENCE,
  scoreBalanceMovement,
  scoreText,
} from "../classification";

import type { TraitSignal, WalletTraitTunables } from "../classification";

const TUNABLES: WalletTraitTunables = {
  owedMarginThreshold: 300,
  owedSampleFloor: 3,
  priorWeight: 100,
};

const SIGNALS: TraitSignal[] = [
  { pattern: "minimum amount due", trait: "owed", weight: 250 },
  { pattern: "statement balance", trait: "owed", weight: 200 },
  { pattern: "available balance", trait: "held", weight: 150 },
];

describe("classifyOwed", () => {
  test("no evidence and no prior reads as held, and says it is not confident", () => {
    expect(classifyOwed(EMPTY_EVIDENCE, "unknown", TUNABLES)).toEqual({
      owed: false,
      confident: false,
    });
  });

  test("owed evidence past both the margin and the sample floor flips the verdict", () => {
    expect(classifyOwed({ owedScore: 600, heldScore: 100, sampleCount: 4 }, "unknown", TUNABLES)).toEqual(
      { owed: true, confident: true },
    );
  });

  test("a big margin from too few samples does not flip", () => {
    expect(classifyOwed({ owedScore: 900, heldScore: 0, sampleCount: 2 }, "unknown", TUNABLES)).toEqual(
      { owed: false, confident: false },
    );
  });

  test("enough samples but a thin margin does not flip", () => {
    expect(classifyOwed({ owedScore: 400, heldScore: 300, sampleCount: 9 }, "unknown", TUNABLES)).toEqual(
      { owed: false, confident: false },
    );
  });

  test("a margin exactly at the threshold counts as settled", () => {
    expect(classifyOwed({ owedScore: 300, heldScore: 0, sampleCount: 3 }, "unknown", TUNABLES)).toEqual(
      { owed: true, confident: true },
    );
  });

  test("a 'likely' prior contributes but cannot decide on its own", () => {
    expect(classifyOwed(EMPTY_EVIDENCE, "likely", TUNABLES)).toEqual({
      owed: false,
      confident: false,
    });

    const nearMiss = { owedScore: 250, heldScore: 0, sampleCount: 3 };
    expect(classifyOwed(nearMiss, "likely", TUNABLES)).toEqual({ owed: true, confident: true });
    expect(classifyOwed(nearMiss, "unknown", TUNABLES)).toEqual({ owed: false, confident: false });
  });

  test("held evidence outweighs a 'likely' prior", () => {
    expect(classifyOwed({ owedScore: 100, heldScore: 500, sampleCount: 5 }, "likely", TUNABLES)).toEqual(
      { owed: false, confident: true },
    );
  });

  test("an 'unlikely' prior can settle a wallet as held", () => {
    expect(classifyOwed({ owedScore: 0, heldScore: 250, sampleCount: 3 }, "unlikely", TUNABLES)).toEqual(
      { owed: false, confident: true },
    );
  });
});

describe("scoreText", () => {
  test("matches case-insensitively", () => {
    expect(scoreText("Your MINIMUM AMOUNT DUE is PHP 1,200", SIGNALS)).toEqual({
      owed: 250,
      held: 0,
    });
  });

  test("scores both sides when both appear", () => {
    expect(scoreText("Statement balance PHP 900. Available balance PHP 10.", SIGNALS)).toEqual({
      owed: 200,
      held: 150,
    });
  });

  test("text with no signal scores nothing", () => {
    expect(scoreText("Padala received", SIGNALS)).toEqual({ owed: 0, held: 0 });
  });

  test("an empty signal pack scores nothing", () => {
    expect(scoreText("minimum amount due", [])).toEqual({ owed: 0, held: 0 });
  });
});

describe("scoreBalanceMovement", () => {
  test("spending that raises the reported balance is credit-shaped", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 250_000,
      }),
    ).toEqual({ owed: 200, held: 0 });
  });

  test("spending that lowers the balance is ordinary", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 150_000,
      }),
    ).toEqual({ owed: 0, held: 200 });
  });

  test("money in that lowers the balance is credit-shaped — a card payment", () => {
    expect(
      scoreBalanceMovement({
        direction: "in",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 150_000,
      }),
    ).toEqual({ owed: 200, held: 0 });
  });

  test("a capture with no reported balance scores nothing either way", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: null,
      }),
    ).toEqual({ owed: 0, held: 0 });

    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: null,
        balanceAfter: 150_000,
      }),
    ).toEqual({ owed: 0, held: 0 });
  });

  test("an unchanged balance scores nothing", () => {
    expect(
      scoreBalanceMovement({
        direction: "out",
        amount: 50_000,
        previousBalance: 200_000,
        balanceAfter: 200_000,
      }),
    ).toEqual({ owed: 0, held: 0 });
  });
});

describe("addEvidence", () => {
  test("accumulates scores and counts one sample per scoring delta", () => {
    const once = addEvidence(EMPTY_EVIDENCE, { owed: 250, held: 0 });
    expect(once).toEqual({ owedScore: 250, heldScore: 0, sampleCount: 1 });
    expect(addEvidence(once, { owed: 0, held: 150 })).toEqual({
      owedScore: 250,
      heldScore: 150,
      sampleCount: 2,
    });
  });

  test("a delta that scored nothing is not a sample", () => {
    expect(addEvidence(EMPTY_EVIDENCE, { owed: 0, held: 0 })).toEqual(EMPTY_EVIDENCE);
  });

  test("does not mutate the evidence it is given", () => {
    const before = { owedScore: 10, heldScore: 20, sampleCount: 1 };
    addEvidence(before, { owed: 5, held: 0 });
    expect(before).toEqual({ owedScore: 10, heldScore: 20, sampleCount: 1 });
  });
});
