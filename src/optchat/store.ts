// Adaptation of jonaslsaa/pi-optchat src/store.ts (MIT): the memory's log, tree and saved view live in the Bot DO's
// SQLite instead of JSONL files. DO storage writes are durable when the call returns, so every write is synchronous.
import type { Entry, Saved, Store, Summary } from "./memory.ts";

export function sqliteStore(sql: SqlStorage): Store & { load(): Saved } {
  sql.exec("CREATE TABLE IF NOT EXISTS optchat_log (i INTEGER PRIMARY KEY, entry TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS optchat_tree (l INTEGER NOT NULL, i INTEGER NOT NULL, node TEXT NOT NULL, PRIMARY KEY (l, i))");
  sql.exec("CREATE TABLE IF NOT EXISTS optchat_view (id INTEGER PRIMARY KEY CHECK (id = 0), view TEXT NOT NULL)");
  return {
    load: () => ({
      entries: sql.exec<{ entry: string }>("SELECT entry FROM optchat_log ORDER BY i").toArray().map((r) => JSON.parse(r.entry)),
      tree: sql.exec<{ node: string }>("SELECT node FROM optchat_tree").toArray().map((r) => JSON.parse(r.node)),
      view: sql.exec<{ view: string }>("SELECT view FROM optchat_view").toArray()[0]?.view,
    }),
    append(entry: Entry) {
      // Upstream's "someone else appended" guard: the primary key refuses a second entry with the same index.
      sql.exec("INSERT INTO optchat_log (i, entry) VALUES (?, ?)", entry.i, JSON.stringify(entry));
      return undefined;
    },
    appendNode(node: Summary) {
      sql.exec("INSERT INTO optchat_tree (l, i, node) VALUES (?, ?, ?)", node.l, node.i, JSON.stringify(node));
      return undefined;
    },
    saveView(view: string) {
      sql.exec("INSERT OR REPLACE INTO optchat_view (id, view) VALUES (0, ?)", view);
      return undefined;
    },
  };
}
