import nodemailer from "nodemailer";
import type { MailConfig } from "../config.js";

export type OtpMail = {
  to: string;
  code: string;
  expiresInMinutes: number;
};

export type SendMail = (message: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<void>;

/** The slice of Fastify's logger this module needs, so tests pass a plain object. */
export type MailLogger = {
  info: (obj: object, msg: string) => void;
};

export type Mailer = {
  sendOtp: (mail: OtpMail) => Promise<void>;
};

// The code is deliberately absent from the subject: a lock-screen notification
// preview shows the subject to anyone holding the phone, which is exactly the
// person a second factor is supposed to exclude.
const SUBJECT = "Your PeraPlano sign-in code";

function body(mail: OtpMail): string {
  return [
    `Your PeraPlano sign-in code is ${mail.code}.`,
    "",
    `It expires in ${String(mail.expiresInMinutes)} minutes and can be used once.`,
    "If you did not ask to sign in, you can ignore this message.",
  ].join("\n");
}

/**
 * The real SMTP sender. Never constructed by the tests: every suite injects its
 * own `SendMail`, so no test opens a socket or reads a password.
 */
export function createSmtpSender(config: Extract<MailConfig, { transport: "smtp" }>): SendMail {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  return async (message) => {
    await transporter.sendMail(message);
  };
}

/**
 * `sendMail` is optional so production can let this build the real sender while
 * tests supply their own. It is only ever consulted by the smtp transport.
 */
export function createMailer(
  config: MailConfig,
  logger: MailLogger,
  sendMail?: SendMail,
): Mailer {
  if (config.transport === "log") {
    return {
      sendOtp: (mail) => {
        // Development delivery. loadConfig refuses this transport when
        // NODE_ENV=production, which is what keeps codes out of a real log.
        logger.info(
          { destination: mail.to, otpCode: mail.code },
          "otp issued (log transport, not delivered)",
        );
        return Promise.resolve();
      },
    };
  }

  const send = sendMail ?? createSmtpSender(config);
  return {
    sendOtp: async (mail) => {
      // Nothing here logs the code. A delivery failure propagates so the route
      // can fail the request rather than promise a mail that never left.
      await send({
        from: `${config.fromName} <${config.fromAddress}>`,
        to: mail.to,
        subject: SUBJECT,
        text: body(mail),
      });
      logger.info({ destination: mail.to }, "otp mail sent");
    },
  };
}
