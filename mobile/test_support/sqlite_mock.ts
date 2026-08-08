// Jest stand-in for @op-engineering/op-sqlite (native module, SQLCipher backend). Mapped via
// jest moduleNameMapper. Implements only the API surface lib/db/database.ts's adapter uses —
// open()/execute()/close() — and does NOT implement SQLCipher itself.
//
// See docs/12-encryption-and-app-lock.md §8 and interface contract §3: repository tests
// exercise repository LOGIC, not encryption. SQLCipher is native and cannot run under Jest;
// encryption is proven by the Kotlin key-wrap tests and the on-device check (Task 10), not by
// this mock. This mock stores everything in sql.js's own in-memory, PLAINTEXT database — the
// `encryptionKey` option passed to open() is accepted (to match the real signature) and then
// ignored entirely.
//
// Backed by sql.js's pure-JS (asm.js) build — not better-sqlite3, and not sql.js's default
// WASM build:
//  - better-sqlite3 is unavailable: this machine has no complete VC++ toolset, so
//    node-gyp cannot build native modules at all.
//  - sql.js's default WASM build (the `sql.js` package main, dist/sql-wasm.js) throws an
//    empty-message Error from inside the compiled module the instant `new SQL.Database()`
//    runs — reproduced even under a bare `testEnvironment: "node"` Jest run (so this is not
//    specific to jest-expo's React Native environment), but the identical code succeeds
//    outside Jest via plain `node -e`. That points at Jest's sandboxed VM context breaking
//    something WebAssembly.instantiate (or Emscripten's environment probing) depends on.
//    dist/sql-asm.js compiles the same SQLite C source to plain JavaScript instead of WASM,
//    exposes an identical runtime API (Database, Statement, exec/run/prepare/step/...), and
//    was confirmed to work under both `testEnvironment: "node"` and jest-expo's actual
//    React Native test environment. No .wasm file, no `wasmBinary`/`locateFile` handling
//    needed as a result.
//
// sql.js still initializes asynchronously: initSqlJs() resolves once and the module is
// cached; every open() call then creates a FRESH in-memory database from that cached module
// (test isolation, mirroring the pre-encryption mock's openDatabaseAsync contract) — but
// op-sqlite's real open() is SYNCHRONOUS (no `await` at the database.ts call site, matching
// on-device code exactly), so the async sql.js init is deferred into the connection's first
// execute()/close() call rather than happening inside open() itself.
import type { SqlJsStatic } from "sql.js";

// `sql.js/dist/sql-asm.js` has no bundled or DefinitelyTyped declarations for this specific
// subpath (only the package's default `main` entry is typed via @types/sql.js), but its
// runtime API is identical to the typed default export's resolved module shape, so we
// require it untyped and cast to that shape's init signature.
const initSqlJs = require("sql.js/dist/sql-asm.js") as () => Promise<SqlJsStatic>;

type SqlJsModule = SqlJsStatic;
type SqlJsDatabase = InstanceType<SqlJsModule["Database"]>;

type BindValue = string | number | null;

export type OPSQLiteQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  insertId?: number;
  rowsAffected: number;
};

let sqlJsPromise: Promise<SqlJsModule> | null = null;

function loadSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

/**
 * Real op-sqlite's execute() "currently runs only the first prepared statement" on native
 * and silently drops the rest of the string — see database.ts's splitStatements() doc for the
 * full reasoning. This mock reproduces exactly that truncation (rather than sql.js's own
 * `.exec()`, which happily runs an entire multi-statement string) SO THAT a database.ts that
 * stopped splitting multi-statement SQL before calling execute() fails HERE, under Jest,
 * instead of only on a real device creating one table instead of nineteen. Deliberately
 * reimplemented independently of database.ts's splitStatements() — this mock must not depend
 * on the internals of the code it stands in for, or a bug shared by both would go uncaught.
 */
function firstStatementOnly(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === ";") {
      return sql.slice(0, i + 1);
    }
  }
  return sql;
}

class OPSQLiteMockConnection {
  private closed = false;

  constructor(private readonly ready: Promise<SqlJsDatabase>) {}

  async execute<T = Record<string, unknown>>(
    sql: string,
    params?: BindValue[],
  ): Promise<OPSQLiteQueryResult<T>> {
    const db = await this.ready;
    const statement = firstStatementOnly(sql);
    const stmt = db.prepare(statement);
    const rows: T[] = [];
    try {
      if (params && params.length) stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    const rowsAffected = db.getRowsModified();
    // sql.js has no dedicated "last insert rowid" getter; ask SQLite directly. This is a
    // connection-level value (sqlite3_last_insert_rowid), so the SELECT below does not
    // disturb it.
    const idResult = db.exec("SELECT last_insert_rowid() AS id;");
    const insertId = idResult.length ? Number(idResult[0].values[0][0]) : undefined;
    return { rows, insertId, rowsAffected };
  }

  close(): void {
    // Best-effort, fire-and-forget: real op-sqlite's close() is synchronous, but this mock's
    // underlying sql.js database may still be mid-initialization. Nothing under Jest depends
    // on the close having physically finished by the time this call returns — each test opens
    // a brand-new in-memory database, so an unclosed previous one has no observable effect.
    void this.ready.then((db) => db.close());
    this.closed = true;
  }

  /**
   * Mirrors real op-sqlite's documented `db.close(); db.delete();` ordering
   * (op-sqlite API docs, "Delete Database File") by THROWING if close()
   * has not already run — this is deliberate, not incidental: it makes
   * database.ts's wipeDatabase() calling delete() before (or instead of)
   * close() fail loudly under Jest, instead of only on a real device
   * attempting to unlink a file a live connection still holds open. There is
   * no real file backing this in-memory sql.js mock, so beyond that ordering
   * check there is nothing further to actually unlink.
   */
  delete(): void {
    if (!this.closed) {
      throw new Error("op-sqlite mock: delete() called before close() — real op-sqlite requires close() first");
    }
  }
}

export function open(_options: { name: string; encryptionKey?: string }): OPSQLiteMockConnection {
  const ready = loadSqlJs().then((SQL) => new SQL.Database());
  return new OPSQLiteMockConnection(ready);
}
