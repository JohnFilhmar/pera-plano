import { COMPLIANCE_FIELDS, parseEnvironment } from "@peraplano/common";
import type { AppConfig, ComplianceContacts } from "@peraplano/common";

/**
 * Deliberately obvious fakes on the .test TLD (RFC 2606). Nothing here may ever look
 * like a real contact — a plausible fixture is one careless copy/paste away from being
 * the value that ships in .env.example and then in the published notice.
 */
export const COMPLETE_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "production",
  PIC_LEGAL_NAME: "Example Controller Inc.",
  PIC_ADDRESS: "1 Example Street, Manila",
  DPO_NAME: "Example Officer",
  DPO_EMAIL: "dpo@example.test",
  SUPPORT_EMAIL: "support@example.test",
  NPC_REGISTRATION: "registration pending",
  PUBLIC_BASE_URL: "https://example.test",
};

export const HOLLOW_ENV: Readonly<Record<string, string>> = { NODE_ENV: "development" };

/**
 * COMPLETE_ENV deliberately leaves the beta webhook unset, so the default fixture exercises
 * the "signups are not open" path — the state the site actually ships in until the Apps
 * Script deployment exists. This fixture is the configured counterpart.
 */
export const BETA_ENV: Readonly<Record<string, string>> = {
  ...COMPLETE_ENV,
  BETA_SIGNUP_WEBHOOK_URL: "https://script.example.test/macros/s/fake/exec",
  BETA_SIGNUP_TOKEN: "fixture-token-0123456789abcdef",
};

export const COMPLETE_CONFIG: AppConfig = parseEnvironment(COMPLETE_ENV).config;
export const BETA_CONFIG: AppConfig = parseEnvironment(BETA_ENV).config;
export const HOLLOW_CONFIG: AppConfig = parseEnvironment(HOLLOW_ENV).config;
export const COMPLETE_CONTACTS: ComplianceContacts = COMPLETE_CONFIG.contacts;
export const HOLLOW_CONTACTS: ComplianceContacts = HOLLOW_CONFIG.contacts;
export const ALL_COMPLIANCE_FIELDS = COMPLIANCE_FIELDS;
