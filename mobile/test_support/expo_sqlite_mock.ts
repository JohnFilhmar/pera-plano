// Jest stand-in for expo-sqlite (native module). Mapped via jest moduleNameMapper.
// Implements only the async API surface PeraPlano uses.
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
// sql.js still initializes asynchronously: initSqlJs() resolves once and the module is
// cached; every openDatabaseAsync() call then creates a FRESH in-memory database from that
// cached module (test isolation), mirroring expo-sqlite's own openDatabaseAsync contract.
import type { SqlJsStatic } from "sql.js";

// `sql.js/dist/sql-asm.js` has no bundled or DefinitelyTyped declarations for this specific
// subpath (only the package's default `main` entry is typed via @types/sql.js), but its
// runtime API is identical to the typed default export's resolved module shape, so we
// require it untyped and cast to that shape's init signature.
const initSqlJs = require("sql.js/dist/sql-asm.js") as () => Promise<SqlJsStatic>;

type SqlJsModule = SqlJsStatic;
type SqlJsDatabase = InstanceType<SqlJsModule["Database"]>;

export type SQLiteRunResult = { lastInsertRowId: number; changes: number };

type BindValue = string | number | null;
type BindArgs = BindValue[] | [BindValue[]];

function flatten(params: BindArgs): BindValue[] {
  return params.length === 1 && Array.isArray(params[0])
    ? (params[0] as BindValue[])
    : (params as BindValue[]);
}

let sqlJsPromise: Promise<SqlJsModule> | null = null;

function loadSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

export class SQLiteDatabase {
  private db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, ...params: BindArgs): Promise<SQLiteRunResult> {
    const values = flatten(params);
    this.db.run(sql, values.length ? values : undefined);
    const changes = this.db.getRowsModified();
    // sql.js has no dedicated "last insert rowid" getter; ask SQLite directly. This is a
    // connection-level value (sqlite3_last_insert_rowid), so the SELECT below does not
    // disturb it.
    const idResult = this.db.exec("SELECT last_insert_rowid() AS id;");
    const lastInsertRowId = idResult.length ? Number(idResult[0].values[0][0]) : 0;
    return { lastInsertRowId, changes };
  }

  async getFirstAsync<T>(sql: string, ...params: BindArgs): Promise<T | null> {
    const values = flatten(params);
    const stmt = this.db.prepare(sql);
    try {
      if (values.length) stmt.bind(values);
      const hasRow = stmt.step();
      return hasRow ? (stmt.getAsObject() as T) : null;
    } finally {
      stmt.free();
    }
  }

  async getAllAsync<T>(sql: string, ...params: BindArgs): Promise<T[]> {
    const values = flatten(params);
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      if (values.length) stmt.bind(values);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    // sql.js's Database has no built-in transaction helper; drive BEGIN/COMMIT manually,
    // same shape as the better-sqlite3 adapter this mock replaces.
    this.db.exec("BEGIN");
    try {
      await work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

export async function openDatabaseAsync(_name: string): Promise<SQLiteDatabase> {
  const SQL = await loadSqlJs();
  return new SQLiteDatabase(new SQL.Database());
}
