import { describe, it, expect } from "vitest";
import { createMailer, type SendMail, type MailLogger } from "../../src/lib/mailer.js";
import type { MailConfig } from "../../src/config.js";

const LOG_CONFIG: MailConfig = { transport: "log" };

const SMTP_CONFIG: MailConfig = {
  transport: "smtp",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "sender@example.com",
  password: "app-password",
  fromAddress: "sender@example.com",
  fromName: "PeraPlano",
};

type Sent = Parameters<SendMail>[0];

function recorder(): {
  logger: MailLogger;
  logged: string;
  entries: string[];
} {
  const entries: string[] = [];
  return {
    logger: {
      info: (obj: object, msg: string) => entries.push(JSON.stringify(obj) + " " + msg),
    },
    get logged() {
      return entries.join("\n");
    },
    entries,
  };
}

describe("createMailer with the log transport", () => {
  it("writes the code to the log and sends no mail", async () => {
    const rec = recorder();
    const sent: Sent[] = [];
    const sendMail: SendMail = (message) => {
      sent.push(message);
      return Promise.resolve();
    };

    await createMailer(LOG_CONFIG, rec.logger, sendMail).sendOtp({
      to: "user@example.com",
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(sent).toHaveLength(0);
    expect(rec.logged).toContain("123456");
  });
});

describe("createMailer with the smtp transport", () => {
  it("sends the code to the recipient from the configured sender", async () => {
    const rec = recorder();
    const sent: Sent[] = [];
    const sendMail: SendMail = (message) => {
      sent.push(message);
      return Promise.resolve();
    };

    await createMailer(SMTP_CONFIG, rec.logger, sendMail).sendOtp({
      to: "user@example.com",
      code: "654321",
      expiresInMinutes: 10,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("user@example.com");
    expect(sent[0]?.from).toBe("PeraPlano <sender@example.com>");
    expect(sent[0]?.text).toContain("654321");
    expect(sent[0]?.text).toContain("10");
  });

  it("keeps the code out of the subject, which shows in a notification preview", async () => {
    const rec = recorder();
    const sent: Sent[] = [];
    const sendMail: SendMail = (message) => {
      sent.push(message);
      return Promise.resolve();
    };

    await createMailer(SMTP_CONFIG, rec.logger, sendMail).sendOtp({
      to: "user@example.com",
      code: "654321",
      expiresInMinutes: 10,
    });

    expect(sent[0]?.subject).not.toContain("654321");
    expect(sent[0]?.subject.length).toBeGreaterThan(0);
  });

  it("never writes the code to the log", async () => {
    const rec = recorder();
    const sendMail: SendMail = () => Promise.resolve();

    await createMailer(SMTP_CONFIG, rec.logger, sendMail).sendOtp({
      to: "user@example.com",
      code: "654321",
      expiresInMinutes: 10,
    });

    expect(rec.logged).not.toContain("654321");
  });

  it("propagates a delivery failure rather than reporting success", async () => {
    const rec = recorder();
    const sendMail: SendMail = () => Promise.reject(new Error("smtp connection refused"));

    await expect(
      createMailer(SMTP_CONFIG, rec.logger, sendMail).sendOtp({
        to: "user@example.com",
        code: "654321",
        expiresInMinutes: 10,
      }),
    ).rejects.toThrow("smtp connection refused");
  });
});
