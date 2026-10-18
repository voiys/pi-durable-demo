import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";
import type { LibraryItem } from "../shared.ts";

/** Rows a `sql` call returns to the model; the rest is counted, so a query can't flood the context. */
const MAX_ROWS = 200;
/** Characters of one cell shown to the model. */
const MAX_CELL = 500;

const cell = (v: unknown) => {
  const s = v === null ? "NULL" : v instanceof ArrayBuffer ? `<${v.byteLength} bytes>` : String(v);
  return (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
};

/**
 * A bot's research workspace (name = `<userId>--<botId>`, like its Bot DO): a SQLite database the bot runs any SQL on
 * (tables it builds from what it reads, temp tables, analysis) and its library of reports. Separate from the Bot DO so
 * the bot's SQL can never touch the conversation's or memory's tables. Reached only over RPC from its Bot DO and the
 * owner-checked server functions.
 */
export class BotData extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)");
  }

  /** Runs one or more statements; the last statement's rows come back as a markdown table. */
  sql(query: string): string {
    const cursor = this.ctx.storage.sql.exec(query);
    const rows = cursor.toArray();
    if (!cursor.columnNames.length) return `OK: ${cursor.rowsWritten} rows written, ${cursor.rowsRead} read.`;
    const shown = rows.slice(0, MAX_ROWS);
    const table = [`| ${cursor.columnNames.join(" | ")} |`, `|${cursor.columnNames.map(() => " --- |").join("")}`, ...shown.map((r) => `| ${cursor.columnNames.map((c) => cell(r[c])).join(" | ")} |`)];
    return `${table.join("\n")}\n(${rows.length} rows${rows.length > MAX_ROWS ? `, first ${MAX_ROWS} shown` : ""})`;
  }

  /** Tables and their columns, for the model's first look and the details panel. */
  schema(): string {
    const tables = this.ctx.storage.sql.exec<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name").toArray();
    return tables.map((t) => `${t.sql};`).join("\n") || "No tables.";
  }

  tables(): { name: string; rows: number }[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'library' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name")
      .toArray()
      .map(({ name }) => ({ name, rows: this.ctx.storage.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).one().n }));
  }

  saveReport(title: string, body: string): LibraryItem {
    if (!title.trim() || !body.trim()) throw new Error("A report needs a title and a body");
    return this.ctx.storage.sql
      .exec<LibraryItem>("INSERT INTO library (title, body, created_at) VALUES (?, ?, ?) RETURNING id, title, created_at AS createdAt", title.trim(), body, Date.now())
      .one();
  }

  library(): LibraryItem[] {
    return this.ctx.storage.sql.exec<LibraryItem>("SELECT id, title, created_at AS createdAt FROM library ORDER BY id DESC").toArray();
  }

  report(id: number): string {
    const row = this.ctx.storage.sql.exec<{ body: string }>("SELECT body FROM library WHERE id = ?", id).toArray()[0];
    if (!row) throw new Error(`No report ${id}`);
    return row.body;
  }

  deleteReport(id: number) {
    this.ctx.storage.sql.exec("DELETE FROM library WHERE id = ?", id);
  }

  async wipe() {
    await this.ctx.storage.deleteAll();
  }
}
