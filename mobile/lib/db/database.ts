// lib/db/database.ts — the ONLY module that opens the SQLite connection. Every repository
// and migrations.ts goes through getDatabase()/SQLiteDatabase; nothing above this file knows
// or cares whether the backing engine is expo-sqlite or (as of Task 7) SQLCipher via
// @op-engineering/op-sqlite. See docs/12-encryption-and-app-lock.md §8 and interface contract
// §3's 2026-08-07 amendment for why: whole-database encryption, contained entirely to this
// directory.
//
// Namespace import, not `import { open } from ...`: Babel's CJS interop can destructure a
// named import into a private local binding at module-load time, which breaks Jest's
// moduleNameMapper-based monkeypatch tests (see key_manager.ts's "JEST/BABEL TRAP" notes and
// the original expo-sqlite version of this file, which used the same namespace-import
// pattern for the identical reason). `OpSqlite.open` is a live property lookup on the shared
// module object both this file and a test's `require(".../sqlite_mock")` see.
import * as OpSqlite from "@op-engineering/op-sqlite";

const DB_NAME = "peraplano.db";

export type SQLiteRunResult = { lastInsertRowId: number; changes: number };

type BindValue = string | number | null;

/**
 * The shape every repository and migrations.ts already depend on. Deliberately unchanged
 * from the pre-encryption expo-sqlite-backed shape (execAsync/runAsync/getFirstAsync/
 * getAllAsync/withTransactionAsync/closeAsync) — op-sqlite's own raw API (execute/close) is
 * quite different, so THIS file adapts it to the shape callers already expect. That is what
 * keeps the swap contained to lib/db/: no repository changed a single call site.
 */
export interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: BindValue[]): Promise<SQLiteRunResult>;
  getFirstAsync<T>(sql: string, params?: BindValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: BindValue[]): Promise<T[]>;
  withTransactionAsync(work: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
  /**
   * Deletes the database FILE from disk. Only ever called by wipeDatabase()
   * (docs/12-encryption-and-app-lock.md §11a) — never by closeDatabase(),
   * which must keep the file intact for the next unlock. MUST be called
   * after closeAsync(), never before: op-sqlite's own documented pattern is
   * `db.close(); db.delete();` (op-sqlite API docs, "Delete Database File").
   */
  deleteAsync(): Promise<void>;
}

/**
 * Thrown by getDatabase() whenever unlockDatabase() has not yet produced a handle.
 *
 * THIS IS THE POINT OF TASK 7. Returning a fresh, empty (and unencrypted) handle instead —
 * "just open a new one, nothing's open yet" — would let a repository silently write into a
 * SECOND, plaintext SQLite file sitting right next to the real encrypted one. The app would
 * look like it was working: reads and writes would succeed, nothing would throw, and nobody
 * would know a plaintext shadow of the user's complete financial history was accumulating on
 * disk until someone went looking for it. Never relax this into a lazy-open fallback; the
 * only legitimate way to get a handle is through unlockDatabase(dek).
 *
 * Callers that run behind the app lock (Task 9) satisfy this by construction. Code paths
 * that can run while locked — the notification listener, scheduled alert delivery — must
 * never touch a repository at all (interface contract §3).
 */
export class DatabaseLockedError extends Error {
  constructor() {
    super("database is locked — call unlockDatabase(dek) before getDatabase()");
    this.name = "DatabaseLockedError";
  }
}

type RawConnection = ReturnType<typeof OpSqlite.open>;

/**
 * Splits a SQL string into individual statements, respecting single- and double-quoted
 * strings and `--`/`/* *\/` comments so a `;` inside a string literal or a comment never
 * creates a false split.
 *
 * WHY THIS EXISTS: op-sqlite's execute() "currently runs only the first prepared statement"
 * on native and silently discards everything after it — no error, no partial-result
 * indicator, nothing. expo-sqlite's execAsync() (what this file used before Task 7) ran every
 * statement in the string, and 001_core.sql — and migrations.ts's own schema_migrations
 * bootstrap — are multi-statement strings written against that expectation. Passing such a
 * string straight to op-sqlite's execute() unsplit would create exactly ONE table (or run
 * exactly one PRAGMA) and report success: a silent partial migration, not a crash. That is
 * the exact failure shape this whole task exists to prevent one layer up (a "looks like it
 * worked" data-integrity bug), so execAsync splits and runs each statement itself rather than
 * trusting op-sqlite to do it.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingleQuote) {
      current += ch;
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') inDoubleQuote = false;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) statements.push(current);

  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

/** Adapts an op-sqlite raw connection to the SQLiteDatabase shape every caller depends on. */
function wrapConnection(raw: RawConnection): SQLiteDatabase {
  return {
    async execAsync(sql: string) {
      for (const statement of splitStatements(sql)) {
        await raw.execute(statement);
      }
    },
    async runAsync(sql: string, params?: BindValue[]) {
      const result = await raw.execute(sql, params);
      return {
        lastInsertRowId: result.insertId ?? 0,
        changes: result.rowsAffected ?? 0,
      };
    },
    async getFirstAsync<T>(sql: string, params?: BindValue[]) {
      const { rows } = await raw.execute(sql, params);
      return rows.length ? (rows[0] as T) : null;
    },
    async getAllAsync<T>(sql: string, params?: BindValue[]) {
      const { rows } = await raw.execute(sql, params);
      return Array.from(rows) as T[];
    },
    async withTransactionAsync(work: () => Promise<void>) {
      // Driven manually with BEGIN/COMMIT/ROLLBACK rather than op-sqlite's own
      // db.transaction((tx) => ...) sugar: every caller (migrations.ts, repositories) already
      // calls back into THIS SAME db's execAsync/runAsync inside the work() callback, not a
      // tx-scoped object — matching that existing call shape exactly is what keeps this swap
      // contained to lib/db/.
      await raw.execute("BEGIN");
      try {
        await work();
        await raw.execute("COMMIT");
      } catch (error) {
        await raw.execute("ROLLBACK");
        throw error;
      }
    },
    async closeAsync() {
      raw.close();
    },
    async deleteAsync() {
      raw.delete();
    },
  };
}

/**
 * Renders the DEK using SQLCipher's raw-key literal syntax (`x'<64 hex chars>'`) instead of
 * handing the bytes to op-sqlite as a passphrase. The DEK is already 256 bits of CSPRNG
 * output (lib/crypto/key_manager.ts) — running SQLCipher's own PBKDF2 on top would be
 * redundant work bought for nothing, and raw-key mode is what SQLCipher itself provides for
 * exactly this case (real key material, not a low-entropy human passphrase).
 *
 * SECURITY: never log this value or include it in a thrown error — it IS the database key.
 */
function toRawKeyLiteral(dek: Uint8Array): string {
  let hex = "";
  for (const byte of dek) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `x'${hex}'`;
}

async function openEncrypted(dek: Uint8Array): Promise<SQLiteDatabase> {
  const raw = OpSqlite.open({ name: DB_NAME, encryptionKey: toRawKeyLiteral(dek) });
  const db = wrapConnection(raw);
  // Contract §3: foreign keys are always enforced.
  await db.execAsync("PRAGMA foreign_keys = ON;");
  return db;
}

let dbPromise: Promise<SQLiteDatabase> | null = null;

/** True once unlockDatabase() has produced (or is producing) a handle not since closed. */
export function isDatabaseUnlocked(): boolean {
  return dbPromise !== null;
}

/**
 * Opens the SQLCipher database with this DEK. Idempotent while already unlocked: a second
 * call returns the SAME handle rather than attempting to re-open (SQLCipher's key is fixed
 * for the lifetime of a connection; re-keying requires closeDatabase() first).
 *
 * If the open fails, dbPromise is left pointing at the rejected promise ON PURPOSE — mirrors
 * the pre-encryption getDatabase()'s "recoverable wedge" contract exactly. Only
 * closeDatabase() clears it, so a caller that races two concurrent unlockDatabase() calls
 * both observe the SAME outcome (both resolve together, or both reject together) rather than
 * one silently retrying behind the other's back.
 */
export function unlockDatabase(dek: Uint8Array): Promise<void> {
  if (dbPromise === null) {
    dbPromise = openEncrypted(dek);
  }
  return dbPromise.then(() => undefined);
}

/**
 * Returns the unlocked database handle. THROWS DatabaseLockedError — see that class's doc —
 * if unlockDatabase() has not yet been called (or has been closed since). Never falls back to
 * opening a fresh, unencrypted handle.
 */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (dbPromise === null) {
    return Promise.reject(new DatabaseLockedError());
  }
  return dbPromise;
}

/** Closes the handle (if any) and returns to the locked state — isDatabaseUnlocked() becomes false. */
export async function closeDatabase(): Promise<void> {
  const promise = dbPromise;
  if (!promise) return;
  // Clear the singleton before awaiting, not after: if `promise` (or `db.closeAsync()`
  // below) rejects, dbPromise must not be left pointing at a dead, already-settled
  // promise — otherwise every later getDatabase()/unlockDatabase() replays that same
  // rejection forever instead of retrying.
  dbPromise = null;
  const db = await promise;
  await db.closeAsync();
}

/**
 * The §11a "wipe and start over" primitive's database half
 * (docs/12-encryption-and-app-lock.md §11a; lib/security/wipe.ts is the full
 * orchestration). Deletes the SQLCipher database FILE from disk — not a
 * logical clear (`DELETE FROM ...`), which would require the DEK to open the
 * file and run a query against it, and the whole point of this function is
 * that it must work in the unrecoverable state, where NO key exists at all.
 *
 * If a handle is already open, it is closed first (never delete a still-open
 * file — see SQLiteDatabase.deleteAsync's doc). If nothing is open, a fresh
 * handle is opened with NO encryption key just to reach the file — safe,
 * because SQLCipher only validates a key against the file's contents on
 * first genuine use (a query/PRAGMA), never at open() itself, and this
 * function never runs one.
 *
 * dbPromise is cleared before either close/delete pair runs — mirroring
 * closeDatabase()'s own ordering — so a failure here still leaves
 * isDatabaseUnlocked() false rather than wedging on a handle this function
 * is in the middle of destroying.
 */
export async function wipeDatabase(): Promise<void> {
  const promise = dbPromise;
  dbPromise = null;

  const db = promise ? await promise : wrapConnection(OpSqlite.open({ name: DB_NAME }));
  await db.closeAsync();
  await db.deleteAsync();
}
