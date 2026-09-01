import type { MailerEnv, Recipient, RenderedInvite } from "@/types/invite";

/**
 * Every interpolated value in the HTML comes from a spreadsheet a stranger typed into. It
 * is escaped on the way in, without exception: a first name of `<b>` is a formatting bug,
 * and a first name containing a tag is worse.
 */
function escape_html(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND = "#15803d";
const BRAND_DARK = "#166534";
const INK = "#10201a";
const MUTED = "#5b6e64";
const MINT = "#dcfce7";
const PAGE = "#f7faf7";
const LINE = "#e3ece6";

function greeting_name(recipient: Recipient): string {
  const first = recipient.first_name.split(/\s+/)[0] ?? "";
  return first === "" ? "there" : first;
}

/** A row of numbered instruction. Tables, not flexbox: Outlook renders neither grid nor flex. */
function step(number: number, heading: string, body: string): string {
  return `
              <tr>
                <td style="padding:0 0 20px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="34" valign="top" style="width:34px;padding:2px 12px 0 0;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" width="26" height="26" style="width:26px;height:26px;background-color:${MINT};border-radius:13px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${BRAND_DARK};line-height:26px;">${number}</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
                        <div style="font-size:16px;font-weight:bold;color:${INK};line-height:24px;">${heading}</div>
                        <div style="font-size:15px;color:${MUTED};line-height:23px;padding-top:4px;">${body}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`;
}

/**
 * Builds one invitation. The opt-in link is the one that matters: Play closed testing hides
 * the store listing until a tester has accepted through it, so when PLAY_OPT_IN_URL is set
 * it becomes the primary button and the store link drops to a secondary step.
 */
export function render_invite(recipient: Recipient, config: MailerEnv): RenderedInvite {
  const name = escape_html(greeting_name(recipient));
  const store_url = escape_html(config.PLAY_STORE_URL);
  const opt_in_url = config.PLAY_OPT_IN_URL ? escape_html(config.PLAY_OPT_IN_URL) : null;
  const beta_url = escape_html(config.BETA_PAGE_URL);
  const primary_url = opt_in_url ?? store_url;
  const primary_label = opt_in_url ? "Accept the tester invite" : "Open PeraPlano on Google Play";
  const support = config.SUPPORT_EMAIL ?? config.MAIL_FROM_EMAIL ?? config.SMTP_USER;
  const support_html = escape_html(support);
  const device_line = recipient.device_model
    ? `<p style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${MUTED};">You told us you would be testing on a ${escape_html(recipient.device_model)}. If that has changed, reply and tell us which phone you are on.</p>`
    : "";

  const steps = [
    opt_in_url
      ? step(
          1,
          "Accept the invitation",
          `Open <a href="${opt_in_url}" style="color:${BRAND_DARK};">the tester opt-in link</a> while signed in as <strong style="color:${INK};">${escape_html(recipient.email)}</strong>, then tap <em>Become a tester</em>.`,
        )
      : step(
          1,
          "Use the right Google account",
          `Your phone's Play Store has to be signed in as <strong style="color:${INK};">${escape_html(recipient.email)}</strong>. That is the address on the tester list, and Play matches on it exactly.`,
        ),
    step(
      2,
      "Install PeraPlano",
      `Open <a href="${store_url}" style="color:${BRAND_DARK};">the Play Store listing</a> and install. If Play says the item was not found, the invite has not propagated yet. Wait a few minutes and open the link again.`,
    ),
    step(
      3,
      "Grant notification access",
      "PeraPlano reads your GCash, Maya, and bank notifications on the device to build your ledger. It asks once on first run. Without it the app has nothing to read.",
    ),
    step(
      4,
      "Use it as your real tracker",
      "A few weeks of actual spending, not a demo you open once. Then tell us every notification it read wrong or missed. That is the whole job.",
    ),
  ].join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Your PeraPlano beta invitation</title>
    <!--[if mso]>
      <style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;background-color:${PAGE};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      Accept the tester invite, install PeraPlano, and keep Plus for life.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PAGE};">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background-color:${BRAND};padding:26px 32px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.2px;">PeraPlano</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MINT};letter-spacing:1.4px;text-transform:uppercase;padding-top:6px;">Closed testing &middot; Android &middot; Philippines</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;color:${INK};">Hi ${name}, you are on the tester list.</h1>
                <p style="margin:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:${MUTED};">
                  You signed up at <a href="${beta_url}" style="color:${BRAND_DARK};">peraplano</a> to help test PeraPlano before launch. The closed test is open, and this address is on the Google Play tester list.
                </p>
                ${device_line}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:6px 32px 26px 32px;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${primary_url}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="20%" stroke="f" fillcolor="${BRAND}">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${primary_label}</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-- -->
                <a href="${primary_url}" style="display:inline-block;background-color:${BRAND};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:48px;text-decoration:none;padding:0 32px;border-radius:10px;">${primary_label}</a>
                <!--<![endif]-->
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 4px 32px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${BRAND_DARK};padding-bottom:16px;">How to get in</div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
${steps}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 32px 0 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${MINT};border-radius:12px;">
                  <tr>
                    <td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:15px;font-weight:bold;color:${INK};line-height:22px;">Plus stays free for you, permanently.</div>
                      <div style="font-size:14px;color:${BRAND_DARK};line-height:22px;padding-top:6px;">When paid tiers arrive after public release, everyone on this list keeps Plus at no cost. Not a trial, not a discount, not a first year.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${MUTED};">
                  Something read wrong, crashed, or never showed up? Reply to this email. One person builds PeraPlano, and your report goes straight to them.
                </p>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">
                  We will never ask for your password. No part of PeraPlano needs one.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 30px 32px;">
                <div style="border-top:1px solid ${LINE};padding-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:20px;color:#8ba095;">
                  You are getting this because you submitted the beta tester form at <a href="${beta_url}" style="color:${MUTED};">${beta_url}</a>.
                  Changed your mind? Reply with the word <strong>remove</strong> and your address comes off the list and out of Play Console.
                  Questions: <a href="mailto:${support_html}" style="color:${MUTED};">${support_html}</a>.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${greeting_name(recipient)}, you are on the PeraPlano tester list.`,
    "",
    `You signed up at ${config.BETA_PAGE_URL} to help test PeraPlano before launch. The closed test is open, and ${recipient.email} is on the Google Play tester list.`,
    "",
    "HOW TO GET IN",
    opt_in_url
      ? `1. Accept the invitation: ${config.PLAY_OPT_IN_URL}\n   Sign in as ${recipient.email} first, then tap "Become a tester".`
      : `1. Sign your phone's Play Store in as ${recipient.email}. That is the address on the tester list.`,
    `2. Install PeraPlano: ${config.PLAY_STORE_URL}\n   If Play says the item was not found, the invite has not propagated yet. Wait a few minutes and open the link again.`,
    "3. Grant notification access when the app asks. That is how PeraPlano reads your GCash, Maya, and bank alerts.",
    "4. Use it as your real tracker for a few weeks, then tell us every notification it read wrong or missed.",
    "",
    "PLUS STAYS FREE FOR YOU, PERMANENTLY",
    "When paid tiers arrive after public release, everyone on this list keeps Plus at no cost. Not a trial, not a discount, not a first year.",
    "",
    "Something read wrong, crashed, or never showed up? Reply to this email. One person builds PeraPlano, and your report goes straight to them.",
    "We will never ask for your password. No part of PeraPlano needs one.",
    "",
    `You are getting this because you submitted the beta tester form at ${config.BETA_PAGE_URL}. Reply with the word "remove" and your address comes off the list and out of Play Console. Questions: ${support}.`,
  ].join("\n");

  const subject =
    greeting_name(recipient) === "there"
      ? "Your PeraPlano beta invitation is ready"
      : `${greeting_name(recipient)}, your PeraPlano beta invitation is ready`;

  return { subject, html, text };
}
