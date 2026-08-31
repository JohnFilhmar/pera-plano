/**
 * PeraPlano — beta tester signup sink (Google Apps Script).
 *
 * This is the far side of `app/api/beta-signup/route.ts`. The web server validates a
 * submission, then POSTs it here server-to-server; this script appends one row to the
 * spreadsheet and nothing else. A visitor's browser never talks to this URL, which is why
 * there is no CORS handling and no reason for one.
 *
 * It is kept in the repository, rather than only inside script.google.com, because it is
 * the half of the feature that is easiest to lose: a deployment lives in one person's
 * Google account, and an undocumented web app is indistinguishable from a broken one.
 *
 * ---------------------------------------------------------------------------------------
 * SETUP — about five minutes.
 *
 *  1. Open the destination spreadsheet, then Extensions -> Apps Script. (Doing it from
 *     inside the sheet binds the script to it, and SHEET_ID below can stay empty. If you
 *     are working in a standalone project instead, set the SHEET_ID script property to the
 *     long id from the spreadsheet's URL.)
 *  2. Replace everything in Code.gs with this file.
 *  3. Project Settings (the gear) -> Script Properties -> Add script property:
 *         Property: BETA_SIGNUP_TOKEN
 *         Value:    a long random string you invent, 32+ characters
 *     Keep that value. It goes into the server's BETA_SIGNUP_TOKEN environment variable,
 *     and the two must match exactly.
 *  4. Back in the editor, choose `setup` in the function dropdown and press Run. Authorise
 *     it when Google asks. It creates the tab and the header row, and it fails loudly if
 *     the token property is missing.
 *  5. Deploy -> New deployment -> type "Web app".
 *         Execute as:      Me
 *         Who has access:  Anyone
 *     "Anyone" is required because the PeraPlano server calls this without a Google
 *     identity. The token in the request body is what actually authorises the write, so
 *     treat the deployment URL as a secret too.
 *  6. Copy the /exec URL into the server's BETA_SIGNUP_WEBHOOK_URL environment variable.
 *
 * Re-deploying after an edit: Deploy -> Manage deployments -> pencil -> Version: New
 * version. Editing the code alone does not change what the /exec URL serves.
 * ---------------------------------------------------------------------------------------
 */

/** Leave empty when the script is bound to the spreadsheet (the normal case). */
const SHEET_ID = '';

const SHEET_NAME = 'beta_signups';

/**
 * Column order is a contract with route.ts and with the spec. Append new columns at the
 * END only — inserting one in the middle silently shifts every future row against every
 * row already written, and nothing here would notice.
 */
const HEADERS = [
  'submitted_at',
  'google_email',
  'first_name',
  'device_model',
  'consent_version',
  'source',
  'request_id',
  'status',
  'notes',
];

/** Play closed testing by email list caps at 100 testers; this is a long way clear of it. */
const MAX_ROWS = 2000;

function setup() {
  const token = PropertiesService.getScriptProperties().getProperty('BETA_SIGNUP_TOKEN');
  if (!token || token.length < 16) {
    throw new Error(
      'BETA_SIGNUP_TOKEN script property is missing or too short. Add it under ' +
        'Project Settings -> Script Properties before running setup, and use at least ' +
        '16 characters.',
    );
  }
  const sheet = getSheet_();
  Logger.log('Ready. Sheet "%s" has %s data row(s).', SHEET_NAME, sheet.getLastRow() - 1);
}

function doGet() {
  // A liveness probe, deliberately mute: it confirms the deployment is reachable and
  // reveals nothing about the token, the sheet, or how many people have signed up.
  return json_({ ok: true, service: 'peraplano-beta-signup' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, error: 'empty_body' });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return json_({ ok: false, error: 'bad_json' });
    }

    const expected = PropertiesService.getScriptProperties().getProperty('BETA_SIGNUP_TOKEN');
    if (!expected) return json_({ ok: false, error: 'not_configured' });
    if (!safeEquals_(String(payload.token || ''), expected)) {
      return json_({ ok: false, error: 'unauthorised' });
    }

    const email = String(payload.google_email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) {
      return json_({ ok: false, error: 'invalid_email' });
    }

    // One writer at a time. Two submissions landing in the same second would otherwise
    // both read the same last row and one would overwrite the other.
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = getSheet_();
      const rowCount = sheet.getLastRow() - 1;
      if (rowCount >= MAX_ROWS) {
        return json_({ ok: false, error: 'list_full' });
      }

      if (findEmailRow_(sheet, email) > 0) {
        // Signing up twice is a person being unsure it worked, not an error. Report it as
        // a success so the page can thank them rather than accusing them of anything.
        return json_({ ok: true, duplicate: true });
      }

      sheet.appendRow([
        Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"),
        email,
        String(payload.first_name || '').trim().slice(0, 80),
        String(payload.device_model || '').trim().slice(0, 120),
        String(payload.consent_version || '').trim().slice(0, 40),
        String(payload.source || 'web').trim().slice(0, 40),
        String(payload.request_id || '').trim().slice(0, 80),
        '', // status — yours to fill in as you invite people
        '', // notes
      ]);
      return json_({ ok: true, duplicate: false });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    // Never echo the error text back to the caller: it can carry sheet names, ids and
    // stack frames. The detail goes to the Apps Script execution log instead.
    Logger.log('beta signup failed: %s', error && error.stack ? error.stack : error);
    return json_({ ok: false, error: 'server_error' });
  }
}

function getSheet_() {
  const book = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
  if (!book) {
    throw new Error(
      'No spreadsheet. Either bind this script to a sheet (Extensions -> Apps Script from ' +
        'inside the spreadsheet) or set SHEET_ID at the top of this file.',
    );
  }
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function findEmailRow_(sheet, email) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const emailColumn = HEADERS.indexOf('google_email') + 1;
  const values = sheet.getRange(2, emailColumn, last - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === email) return i + 2;
  }
  return -1;
}

/**
 * Length-independent comparison. `a === b` on a secret leaks its length and, in principle,
 * how far a guess got before diverging. The cost here is nothing and the habit is worth
 * keeping.
 */
function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
