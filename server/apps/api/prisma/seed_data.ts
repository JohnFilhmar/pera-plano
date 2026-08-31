// Initial parser ruleset — ILLUSTRATIVE placeholder templates only.
// Real notification formats are captured from team devices and maintained as
// a versioned corpus (docs/03-ingest-pipeline.md SS11.3); they replace these
// templates in later ruleset versions via the same /v1/parser_rules channel.
// Package names are indicative and must be verified at implementation.

export type ParserTemplate = {
  id: string;
  match: string;
  direction?: "in" | "out";
  confidence: number;
};

export type ProviderRuleset = {
  providerKey: string;
  packageNames: string[];
  version: number;
  templates: ParserTemplate[];
};

export type RulesetPayload = {
  version: number;
  providers: ProviderRuleset[];
};

export const INITIAL_RULESET: RulesetPayload = {
  version: 1,
  providers: [
    {
      providerKey: "gcash",
      packageNames: ["com.globe.gcash.android"],
      version: 1,
      templates: [
        {
          id: "gcash_send_v1",
          match:
            "^You have sent ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<counterparty>.+?)\\. Ref No\\. (?<ref>[A-Za-z0-9]+)\\.(?: Your new balance is ₱(?<balance>[0-9,]+\\.[0-9]{2})\\.)?$",
          direction: "out",
          confidence: 1,
        },
        {
          id: "gcash_receive_v1",
          match:
            "^You have received ₱(?<amount>[0-9,]+\\.[0-9]{2}) from (?<counterparty>.+?)\\.",
          direction: "in",
          confidence: 1,
        },
        {
          id: "gcash_pay_qr_v1",
          match:
            "^Payment of ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<merchant>.+?) (?:was successful|is complete)",
          direction: "out",
          confidence: 0.9,
        },
      ],
    },
    {
      providerKey: "maya",
      packageNames: ["com.paymaya"],
      version: 1,
      templates: [
        {
          id: "maya_send_v1",
          match:
            "^You sent ₱(?<amount>[0-9,]+\\.[0-9]{2}) to (?<counterparty>.+?)\\.",
          direction: "out",
          confidence: 1,
        },
        {
          id: "maya_receive_v1",
          match:
            "^You received ₱(?<amount>[0-9,]+\\.[0-9]{2}) from (?<counterparty>.+?)\\.",
          direction: "in",
          confidence: 1,
        },
      ],
    },
    {
      providerKey: "bpi",
      packageNames: ["com.bpi.ng.app", "com.google.android.apps.messaging"],
      version: 1,
      templates: [
        {
          id: "bpi_debit_sms_v1",
          match:
            "^BPI: Your account ending (?<accountTail>[0-9]{4}) was debited ₱(?<amount>[0-9,]+\\.[0-9]{2})",
          direction: "out",
          confidence: 0.9,
        },
        {
          id: "bpi_credit_sms_v1",
          match:
            "^BPI: Your account ending (?<accountTail>[0-9]{4}) was credited ₱(?<amount>[0-9,]+\\.[0-9]{2})",
          direction: "in",
          confidence: 0.9,
        },
      ],
    },
  ],
};
