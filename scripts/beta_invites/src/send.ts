import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import nodemailer from "nodemailer";
import { from_address, load_config } from "@/src/config";
import { append_ledger, read_ledger } from "@/src/ledger";
import { load_recipients } from "@/src/recipients";
import { render_invite } from "@/src/template";
import type { Recipient } from "@/types/invite";

const USAGE = `
PeraPlano beta invitations.

  npm run send -- --file recipients.csv [options]

  --file <path>     Tester list: .csv exported from the beta_signups sheet, a .json array,
                    or a .txt file with one address per line. Default: recipients.csv
  --dry-run         Render every message to ./preview and send nothing. No SMTP connection.
  --only <email>    Send to this one address only. Use it on yourself before a real run.
  --limit <n>       Stop after n messages this run.
  --force           Ignore the sent log and mail everyone again. Rarely what you want.
  --env <path>      Credentials file. Default: .env
  --log <path>      Sent log. Default: sent_log.jsonl
  --help
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function preview_name(email: string): string {
  return `${email.replace(/[^a-z0-9]+/gi, "_")}.html`;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      file: { type: "string", default: "recipients.csv" },
      "dry-run": { type: "boolean", default: false },
      only: { type: "string" },
      limit: { type: "string" },
      force: { type: "boolean", default: false },
      env: { type: "string", default: ".env" },
      log: { type: "string", default: "sent_log.jsonl" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const dry_run = values["dry-run"] === true;
  const log_path = values.log ?? "sent_log.jsonl";
  const config = load_config(values.env ?? ".env");
  const loaded = load_recipients(values.file ?? "recipients.csv");

  for (const rejected of loaded.rejected) process.stderr.write(`  skipped row: ${rejected}\n`);
  if (loaded.duplicates.length > 0) {
    process.stdout.write(`  ${loaded.duplicates.length} duplicate address(es) collapsed\n`);
  }

  const already_sent = values.force === true ? new Set<string>() : read_ledger(log_path);
  const only = values.only?.trim().toLowerCase();
  const requested_limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
  if (requested_limit !== undefined && !Number.isFinite(requested_limit)) {
    throw new Error(`--limit must be a number, got "${values.limit}".`);
  }

  let queue: Recipient[] = loaded.recipients.filter((recipient) => {
    if (only !== undefined && recipient.email !== only) return false;
    return !already_sent.has(recipient.email);
  });

  const cap = Math.min(requested_limit ?? config.DAILY_LIMIT, config.DAILY_LIMIT);
  if (queue.length > cap) {
    process.stdout.write(
      `  ${queue.length} queued, capping this run at ${cap}. Re-run tomorrow for the rest; the sent log makes that safe.\n`,
    );
    queue = queue.slice(0, cap);
  }

  process.stdout.write(
    `\n  list: ${loaded.recipients.length} valid, ${already_sent.size} already mailed, ${queue.length} to send\n` +
      `  from: ${from_address(config)}\n` +
      `  play: ${config.PLAY_OPT_IN_URL ?? config.PLAY_STORE_URL}\n`,
  );
  if (config.PLAY_OPT_IN_URL === undefined) {
    process.stdout.write(
      "  note: PLAY_OPT_IN_URL is unset, so the mail links to the public store page only.\n" +
        "        Closed-testing recipients normally need the opt-in link from Play Console.\n",
    );
  }
  if (queue.length === 0) {
    process.stdout.write("  nothing to do\n\n");
    return 0;
  }

  if (dry_run) {
    const directory = "preview";
    mkdirSync(directory, { recursive: true });
    for (const recipient of queue) {
      const invite = render_invite(recipient, config);
      writeFileSync(join(directory, preview_name(recipient.email)), invite.html, "utf8");
      process.stdout.write(`  would send to ${recipient.email}: ${invite.subject}\n`);
    }
    process.stdout.write(`\n  dry run. ${queue.length} message(s) written to ./${directory}\n\n`);
    return 0;
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // 465 is implicit TLS. Any other port starts in the clear and upgrades with STARTTLS,
    // which nodemailer does automatically against Gmail on 587.
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    // One connection, one message at a time. Gmail answers a burst with a 4.7.0 rate-limit
    // block on the whole account, which costs far more than the seconds saved.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  });

  // Fail on bad credentials before the first message rather than partway through the list.
  await transporter.verify();
  process.stdout.write(`  smtp: authenticated as ${config.SMTP_USER}\n\n`);

  let sent = 0;
  const failures: { email: string; reason: string }[] = [];

  for (const [index, recipient] of queue.entries()) {
    const invite = render_invite(recipient, config);
    try {
      const info = await transporter.sendMail({
        from: from_address(config),
        to: recipient.email,
        replyTo: config.MAIL_REPLY_TO ?? config.MAIL_FROM_EMAIL ?? config.SMTP_USER,
        subject: invite.subject,
        text: invite.text,
        html: invite.html,
        headers: {
          // Bulk mail that cannot be unsubscribed from is what spam filters are built to
          // catch. There is no list server here, so the reply address is the honest answer.
          "List-Unsubscribe": `<mailto:${config.MAIL_REPLY_TO ?? config.SMTP_USER}?subject=remove>`,
        },
      });
      append_ledger(log_path, {
        email: recipient.email,
        sent_at: new Date().toISOString(),
        message_id: info.messageId,
      });
      sent += 1;
      process.stdout.write(`  sent  ${recipient.email}\n`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ email: recipient.email, reason });
      process.stderr.write(`  FAIL  ${recipient.email}: ${reason}\n`);
    }

    if (index < queue.length - 1) await sleep(config.SEND_DELAY_MS);
  }

  transporter.close();

  process.stdout.write(`\n  ${sent} sent, ${failures.length} failed\n`);
  if (failures.length > 0) {
    process.stdout.write("  failures are not in the sent log, so re-running retries them.\n");
  }
  process.stdout.write("\n");
  return failures.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exitCode = 1;
  });
