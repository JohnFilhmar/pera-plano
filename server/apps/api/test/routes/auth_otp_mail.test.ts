import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import type { MailConfig } from "../../src/config.js";
import type { SendMail } from "../../src/lib/mailer.js";

const SMTP_CONFIG: MailConfig = {
  transport: "smtp",
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "sender@example.com",
  password: "app-password",
  fromAddress: "sender@example.com",
  fromName: "PeraPlano",
};

type Sent = Parameters<SendMail>[0];

const sent: Sent[] = [];
let failNext = false;

const sendMail: SendMail = (message) => {
  if (failNext) return Promise.reject(new Error("smtp connection refused"));
  sent.push(message);
  return Promise.resolve();
};

const app = buildApp({ mail: SMTP_CONFIG }, { sendMail });

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
  sent.length = 0;
  failNext = false;
});

describe("POST /v1/auth/otp/request delivery", () => {
  it("mails the code to the destination and still returns only a requestId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "juan@example.com" },
    });

    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("juan@example.com");
    expect(sent[0]?.from).toBe("PeraPlano <sender@example.com>");

    // The code reaches the mailbox and nothing else. A caller who could read it
    // from the response would not need the mailbox at all.
    const code = /\b(\d{6})\b/.exec(sent[0]?.text ?? "")?.[1];
    expect(code).toBeDefined();
    expect(res.body).not.toContain(code ?? "");
  });

  it("fails the request when delivery fails, rather than reporting success", async () => {
    failNext = true;

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "juan@example.com" },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "mail_delivery_failed",
    );
  });
});
