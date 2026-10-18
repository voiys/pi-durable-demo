// Generates ARCHITECTURE.md from the code (src/, migrations/, alchemy.run.ts) and the local SQLite files under
// .alchemy/local (opened read-only). `--check` only verifies. Exit code 0 = pass, 1 = fail.
//   node scripts/infra-map.ts           regenerate ARCHITECTURE.md
//   node scripts/infra-map.ts --check   verify code, SQLite, ownership rules and that ARCHITECTURE.md is current
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { finish, kindOf, query, ROOT, sqliteFiles } from "./lib.ts";

const OUT = "ARCHITECTURE.md";
const CHECK = process.argv.includes("--check");
const files: Record<string, string> = {};
const read = (p: string) => (files[p] ??= readFileSync(ROOT + p, "utf8"));
const walk = (dir: string, ext: RegExp) =>
  readdirSync(ROOT + dir, { recursive: true, encoding: "utf8" }).filter((f) => ext.test(f) && !f.endsWith(".gen.ts")).sort().map((f) => `${dir}/${f}`);
const SRC = walk("src", /\.tsx?$/);
const lines = (p: string) => read(p).split("\n").map((text, i) => ({ text, n: i + 1 }));
const hits = (paths: string[], re: RegExp) =>
  paths.flatMap((file) => lines(file).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.text)).flatMap((l) => [...l.text.matchAll(new RegExp(re, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => ({ file, n: l.n, m }))));
const loc = (h: { file: string; n: number }) => `${h.file.replace(/^src\//, "")}:${h.n}`;
const locs = (hs: { file: string; n: number }[]) => (hs.length ? hs.map(loc).join(", ") : "-");

// Which DO object each source file belongs to (the one class file that owns the storage it touches).
const OBJECT_OF_FILE: Record<string, string> = { "src/server/user.ts": "User", "src/server/chat.ts": "Chat", "src/optchat/store.ts": "Chat" };
const objectOf = (file: string) => OBJECT_OF_FILE[file] ?? assert(false, `${file} touches storage/RPC but is not attributed to an object`);
// Caller label (and mermaid node) per file for RPC edges.
const CALLER_OF = (file: string) =>
  OBJECT_OF_FILE[file] ??
  (file === "src/worker.ts" ? "Worker gate" : file === "src/server/fns.ts" ? "Server fns" : file.startsWith("src/routes/") ? "Worker route" : assert(false, `${file} makes RPC calls but has no caller label`));
const NODE: Record<string, string> = { User: "User", Chat: "Chat", "Worker gate": "Gate", "Server fns": "Fns", "Worker route": "Routes" };

function assert(cond: unknown, msg: string): never | void {
  if (!cond) throw new Error(msg);
}

// ---- Ownership rules: the only hand-written part. Every regex is asserted against the code. ----
type Probe = { file?: string; except?: string[]; re: RegExp; why: string; not?: true };
const RULES: { binding?: string; obj: string; key: string; owner: string; probes: Probe[] }[] = [
  {
    binding: "User", obj: "User", key: "user id", owner: "one instance per user",
    probes: [
      { file: "src/worker.ts", re: /kind === "user" && name === id/, why: "gate: /agents/user/<name> only when name is the caller's id" },
      { file: "src/worker.ts", re: /const id = session\.user\.id/, why: "gate: id is the better-auth session user id" },
      { file: "src/server/fns.ts", re: /env\.User\.getByName\(\(await requireUser\(getRequestHeaders\(\)\)\)\.id\)/, why: "server fns open User by session user id" },
      { file: "src/routes/auth.callback.ts", re: /const \{ id \} = await requireUser[\s\S]*env\.User\.getByName\(id\)/, why: "callback route opens User by session user id" },
    ],
  },
  {
    binding: "Chat", obj: "Chat", key: "`<userId>--<chatId>`", owner: "one instance per chat in the user's User catalog",
    probes: [
      { file: "src/shared.ts", re: /chatObjectName = \(userId: string, chatId: string\) => `\$\{userId\}--\$\{chatId\}`/, why: "chatObjectName builds userId--chatId" },
      { file: "src/worker.ts", re: /name\?\.startsWith\(`\$\{id\}--`\)/, why: "gate: chat name must start with the caller's id" },
      { file: "src/worker.ts", re: /env\.User\.getByName\(id\)\.hasChat\(chatId\)/, why: "gate: chatId must be in the caller's catalog" },
      { file: "src/server/fns.ts", re: /hasChat\(chatId\)\)\) throw[\s\S]*env\.Chat\.getByName\(chatObjectName\(await owner\(chatId\), chatId\)\)/, why: "server fns: hasChat (owner) before opening the Chat" },
      { file: "src/server/user.ts", re: /^(?![\s\S]*env\.Chat\.getByName\((?!chatObjectName\(this\.name, chatId\)\)))/, why: "User opens only its own chats (chatObjectName(this.name, chatId))" },
      { file: "src/server/chat.ts", re: /userId = this\.#name\.split\("--"\)\[0\][\s\S]*chatId = this\.#name\.split\("--"\)\[1\]/, why: "Chat parses userId--chatId from its name" },
      { file: "src/server/chat.ts", re: /this\.env\.Chat\.getByName\(`\$\{this\.userId\}--\$\{chatId\}`\)\.receive/, why: "Chat-to-Chat stays inside the same user" },
    ],
  },
  {
    binding: "DB", obj: "D1", key: "-", owner: "shared by all users, better-auth tables only",
    probes: [
      { file: "src/server/auth.ts", re: /database: env\.DB/, why: "better-auth is the D1 consumer" },
      { except: ["src/server/auth.ts", "src/env.ts"], re: /\bDB\b/, why: "no other source file touches the DB binding" },
      { file: "alchemy.run.ts", re: /D1\.Database[\s\S]*D1\.Database/, why: "exactly one D1 database", not: true },
    ],
  },
  {
    obj: "Gate", key: "-", owner: "-",
    probes: [
      { file: "src/worker.ts", re: /new Response\("Unauthorized", \{ status: 401 \}\)/, why: "gate: 401 without a session" },
      { file: "src/worker.ts", re: /new Response\("Forbidden", \{ status: 403 \}\)/, why: "gate: 403 when not allowed" },
    ],
  },
];

// ---- Code: tables, kv keys, RPC edges, routes, bindings ----
const tables = [
  ...hits(SRC, /CREATE\s+(VIRTUAL\s+)?TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i).map((h) => ({ obj: objectOf(h.file), name: h.m[2], virtual: !!h.m[1], at: h })),
  ...hits(walk("migrations", /\.sql$/), /create table "(\w+)"/i).map((h) => ({ obj: "D1", name: h.m[1], virtual: false, at: h })),
];
const kvOps = hits(SRC, /(?:kv\.(get|put|delete)|#(kv)<[^>]*>)\(\s*"([^"]+)"/).map((h) => ({ obj: objectOf(h.file), key: h.m[3], write: h.m[1] === "put" || h.m[1] === "delete", at: h }));
const RPC_RES: [RegExp, number, number | string][] = [
  [/\benv\.(User|Chat)\.getByName\((?:[^()]|\([^()]*\))*\)\.(\w+)\(/g, 2, 1],
  [/#user\(\)\.(\w+)\(/g, 1, "User"],
  [/\(await user\(\)\)\.(\w+)\(/g, 1, "User"],
  [/\(await chat\([^()]*\)\)\.(\w+)\(/g, 1, "Chat"],
];
const rpcs = SRC.flatMap((file) =>
  RPC_RES.flatMap(([re, mi, ti]) => hits([file], re).map((h) => ({ from: CALLER_OF(file), to: typeof ti === "number" ? h.m[ti] : ti, method: h.m[mi], at: h }))),
);
const worker = read("src/worker.ts");
const classFile = (cls: string) => worker.match(new RegExp(`export \\{ ${cls} \\} from "\\./([^"]+)"`))?.[1] ?? assert(false, `worker.ts does not export ${cls}`);
const alchemy = read("alchemy.run.ts");
const decl = Object.fromEntries([...alchemy.matchAll(/export const (\w+) = Cloudflare\.([\w.]+)\(/g)].map((m) => [m[1], m[2]]));
const envBlock = alchemy.match(/env: \{\n([\s\S]*?)\n  \},/)?.[1] ?? assert(false, "alchemy.run.ts has no env block");
const bindings = [...String(envBlock).matchAll(/^\s+(\w+)(?::\s*(.+?))?,$/gm)].map((m) => {
  const dop = m[2]?.match(/Cloudflare\.DurableObject<(\w+)>/);
  const cls = dop?.[1];
  const kind = dop ? "Durable Object" : decl[m[1]] ? decl[m[1]] : new RegExp(`process\\.env\\.${m[1]}\\b`).test(alchemy) ? "secret (.env)" : assert(false, `unknown binding ${m[1]}`);
  return { name: m[1], kind: String(kind), cls, file: cls ? `src/${classFile(cls)}` : undefined };
});
assert(bindings.length && rpcs.length && kvOps.length && tables.length, "extraction found nothing");

const routes: { path: string; rule: string }[] = [];
const gatePrefix = worker.match(/pathname\.startsWith\("([^"]+)"\)/)?.[1] ?? assert(false, "no /agents/ prefix in worker.ts");
const GATE_RULE = { user: "401 without session; 403 unless `name` is the caller's id", chat: "401 without session; 403 unless `name` is `<callerId>--<chatId>` and `User.hasChat(chatId)`" };
for (const k of worker.matchAll(/kind === "(\w+)"/g)) routes.push({ path: `${gatePrefix}${k[1]}/:name`, rule: GATE_RULE[k[1] as "user" | "chat"] ?? assert(false, `no rule text for gate kind ${k[1]}`) });
routes.push({ path: "everything else", rule: "TanStack Start handler (rule per route below)" });
for (const h of hits(walk("src/routes", /\.tsx?$/).map((f) => f), /createFileRoute\("([^"]+)"\)/)) {
  const src = read(h.file);
  const rule = /auth\(\)\.handler/.test(src) ? "better-auth handler (sign-in/up are public)" : /requireUser/.test(src) ? "`requireUser`: 401 without session" : /redirect\(\{ to: "\/login" \}\)/.test(src) ? "session or redirect to /login" : "public";
  routes.push({ path: h.m[1].replace(/\$$/, "*"), rule });
}
const fnsSrc = read("src/server/fns.ts");
for (const block of fnsSrc.split("export const ").slice(1)) {
  const [, name, method] = block.match(/^(\w+) = createServerFn\(\{ method: "(\w+)" \}\)/) ?? assert(false, "unparsed server fn");
  const rule = /\(await chat\(|await owner\(/.test(block) ? "`requireUser` + `User.hasChat`" : /\(await user\(\)\)/.test(block) ? "`requireUser`" : /getSession/.test(block) ? "public (returns session or null)" : assert(false, `no rule for server fn ${name}`);
  routes.push({ path: `serverFn ${name} (${method})`, rule });
}

// ---- SQLite (read-only) ----
// Per object kind: how many local instances, and in how many of them each table exists.
const sqlite: Record<string, { count: number; tables: Map<string, number> }> = { D1: { count: 0, tables: new Map() }, User: { count: 0, tables: new Map() }, Chat: { count: 0, tables: new Map() } };
for (const file of sqliteFiles().filter((f) => kindOf(f) in sqlite)) {
  const k = sqlite[kindOf(file)];
  k.count++;
  for (const { name } of query<{ name: string }>(file, "SELECT name FROM sqlite_master WHERE type = 'table'")) k.tables.set(name, (k.tables.get(name) ?? 0) + 1);
}
const ftsShadow = (obj: string) => tables.filter((t) => t.obj === obj && t.virtual).map((t) => new RegExp(`^${t.name}_(config|content|data|docsize|idx)$`));
const LIBS: [RegExp, string, string][] = [
  [/^pi_/, "pi-durable (PiHarness)", "chat"],
  [/^cf_agents?/, "agents SDK (Agent / Lifecycle)", "agent"],
  [/^_cf_/, "workerd internals", "runtime"],
  [/^__alchemy_migrations$/, "alchemy", "shared"],
];
function libOf(obj: string, name: string) {
  if (ftsShadow(obj).some((re) => re.test(name))) return { lib: "FTS5 shadow tables of `messages`", scope: "user" };
  const l = LIBS.find(([re]) => re.test(name));
  return l && { lib: l[1], scope: l[2] };
}
const codeNames = (obj: string) => new Set(tables.filter((t) => t.obj === obj).map((t) => t.name));
const real = (obj: string) => [...sqlite[obj].tables.keys()].sort();
const unexplained = (obj: string) => real(obj).filter((n) => !codeNames(obj).has(n) && !libOf(obj, n));

// ---- Checks ----
type Check = { id: string; name: string; ok: boolean; detail: string };
const classOf = (obj: string) => bindings.find((b) => b.name === obj)!;
function checks(): Check[] {
  const out: Check[] = [];
  const OBJS = ["D1", "User", "Chat"];
  for (const obj of OBJS) {
    const u = unexplained(obj);
    out.push({ id: "a", name: `SQLite tables explained [${obj}]`, ok: !u.length, detail: u.length ? `not in code or a library prefix: ${u.join(", ")}` : `${real(obj).length} tables, ${sqlite[obj].count} instance(s)` });
  }
  for (const obj of OBJS) {
    const missing = [...codeNames(obj)].filter((n) => !sqlite[obj].tables.has(n));
    out.push({ id: "b", name: `code tables exist in an instance [${obj}]`, ok: !sqlite[obj].count || !missing.length, detail: !sqlite[obj].count ? "skipped, no instances" : missing.length ? `never seen in ${sqlite[obj].count} instance(s): ${missing.join(", ")} (created lazily; for optchat_* run scripts/lineage.ts)` : `${codeNames(obj).size} tables` });
  }
  for (const r of RULES)
    for (const p of r.probes) {
      const targets = p.file ? [p.file] : SRC.filter((f) => !p.except!.includes(f));
      const ok = p.file ? p.re.test(read(p.file)) !== !!p.not : !targets.some((f) => p.re.test(read(f)));
      out.push({ id: "c", name: `${r.obj} rule: ${p.why}`, ok, detail: p.file ?? `checked ${targets.length} files` });
    }
  const missing = [...new Set(rpcs.map((r) => `${r.to}.${r.method}`))].filter((t) => {
    const [to, m] = t.split(".");
    return !new RegExp(`^\\s*(?:async\\s+)?${m}\\s*[(<]`, "m").test(read(`src/${classFile(to)}`));
  });
  out.push({ id: "e", name: "RPC methods exist on their target class", ok: !missing.length, detail: missing.length ? missing.join(", ") : `${new Set(rpcs.map((r) => `${r.to}.${r.method}`)).size} methods` });
  return out;
}

// ---- Render ----
const esc = (s: string) => s.replaceAll("|", "\\|");
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
const SCOPE: Record<string, string> = { User: "user", Chat: "chat", D1: "shared" };
const tick = (s: string) => `\`${s}\``;

function render(): string {
  const edges = new Map<string, Set<string>>();
  const edge = (a: string, b: string, label: string) => edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? new Set()).add(label));
  for (const r of rpcs) edge(NODE[r.from], r.to, r.method);
  const authUsers = [["src/worker.ts", "Gate"], ["src/server/fns.ts", "Fns"], ...walk("src/routes", /\.tsx?$/).map((f) => [f, "Routes"])].filter(([f]) => /from\s+"[^"]*\bauth\.ts"/.test(read(f)));
  const mermaid = [
    "flowchart LR",
    "  Browser([Browser])",
    '  Gate["Worker gate<br/>src/worker.ts"]',
    '  Fns["Server fns<br/>src/server/fns.ts"]',
    '  Routes["Routes<br/>src/routes"]',
    '  Auth["better-auth<br/>src/server/auth.ts"]',
    '  User[("User DO<br/>one per user")]',
    '  Chat[("Chat DO<br/>one per chat")]',
    '  D1[("D1<br/>auth tables")]',
    `  Browser -->|"WebSocket ${gatePrefix}*"| Gate`,
    '  Browser -->|"RPC over HTTP"| Fns',
    '  Browser -->|"pages, auth"| Routes',
    ...[...worker.matchAll(/kind === "(\w+)"/g)].map((k) => `  Gate -->|"routeAgentRequest ${k[1]}"| ${k[1] === "user" ? "User" : "Chat"}`),
    ...authUsers.map(([, n]) => `  ${n} --> Auth`).filter((l, i, a) => a.indexOf(l) === i),
    "  Auth -->|SQL| D1",
    ...[...edges].map(([k, v]) => `  ${k.split("|")[0]} -->|"${[...v].sort().join(", ")}"| ${k.split("|")[1]}`),
  ].join("\n");

  const objects = table(
    ["Binding", "Kind", "Class", "Instance key", "Owner"],
    bindings.map((b) => {
      const r = RULES.find((r) => r.binding === b.name);
      const cls = b.cls && b.file ? `${b.cls} extends ${read(b.file).match(new RegExp(`class ${b.cls} extends (\\w+)`))![1]}${["Lifecycle", "PiHarness"].filter((t) => new RegExp(`\\b${t}\\.|new ${t}\\b`).test(read(b.file!))).map((t) => ` + ${t}`).join("")} (${b.file})` : "-";
      return [tick(b.name), b.kind, cls, r?.key ?? "-", r?.owner ?? "Worker env"];
    }),
  );

  const rows: string[][] = [];
  for (const obj of ["D1", "User", "Chat"]) {
    const present = (n: string) => (sqlite[obj].count ? (sqlite[obj].tables.has(n) ? "yes" : "no") : "n/a");
    for (const t of tables.filter((t) => t.obj === obj)) {
      const w = obj === "D1" ? "better-auth (server/auth.ts)" : locs(hits(Object.keys(OBJECT_OF_FILE).filter((f) => OBJECT_OF_FILE[f] === obj), new RegExp(`\\b(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${t.name}\\b`, "i")));
      const rd = obj === "D1" ? w : locs(hits(Object.keys(OBJECT_OF_FILE).filter((f) => OBJECT_OF_FILE[f] === obj), new RegExp(`(?<!DELETE\\s+)\\b(?:FROM|JOIN)\\s+${t.name}\\b`, "i")));
      rows.push([obj, `${tick(t.name)}${t.virtual ? " (FTS5)" : ""}`, `code: ${loc(t.at)}`, SCOPE[obj], w, rd, present(t.name)]);
    }
    const keys = [...new Set(kvOps.filter((k) => k.obj === obj).map((k) => k.key))].sort();
    for (const key of keys) {
      const ops = kvOps.filter((k) => k.obj === obj && k.key === key);
      rows.push([obj, `kv ${tick(key)}`, `code: ${loc(ops[0].at)}`, SCOPE[obj], locs(ops.filter((o) => o.write).map((o) => o.at)), locs(ops.filter((o) => !o.write).map((o) => o.at)), "n/a"]);
    }
    const groups = new Map<string, { scope: string; names: string[] }>();
    for (const n of real(obj)) {
      const l = !codeNames(obj).has(n) && libOf(obj, n);
      if (l) groups.set(l.lib, { scope: l.scope, names: [...(groups.get(l.lib)?.names ?? []), n] });
    }
    for (const [lib, g] of [...groups].sort()) rows.push([obj, g.names.map(tick).join(", "), `library: ${lib}`, g.scope, lib, lib, "yes"]);
  }
  const storage = table(["Object", "Table / kv key", "Source", "Owner scope", "Writers", "Readers", "In SQLite"], rows);

  const rpc = new Map<string, string[]>();
  for (const r of rpcs) rpc.set(`${r.from}|${r.to}|${r.method}`, [...(rpc.get(`${r.from}|${r.to}|${r.method}`) ?? []), `${r.at.file}:${r.at.n}`]);
  const rpcTable = table(["From", "To", "Method", "file:line"], [...rpc].sort().map(([k, v]) => [...k.split("|").map((c, i) => (i === 2 ? tick(c) : c)), v.join(", ")]));

  return [
    "# Architecture",
    "",
    "<!-- Generated by scripts/infra-map.ts from the code and the local SQLite files. Do not edit; run `node scripts/infra-map.ts`. `--check` verifies. -->",
    "",
    "## Map",
    "",
    "```mermaid",
    mermaid,
    "```",
    "",
    "## Objects",
    "",
    objects,
    "",
    "## Storage",
    "",
    "Scope: `user`/`chat` = per User/Chat instance, `shared` = D1, `agent` = agents SDK runtime state, `runtime` = workerd.",
    "",
    storage,
    "",
    "## RPC edges",
    "",
    rpcTable,
    "",
    "## Routes",
    "",
    table(["Path", "Auth rule"], routes.map((r) => [tick(r.path), r.rule])),
    "",
  ].join("\n");
}

// ---- Run ----
const results = checks();
const doc = render();
if (CHECK) {
  const current = existsSync(ROOT + OUT) ? readFileSync(ROOT + OUT, "utf8") : undefined;
  results.push({ id: "d", name: `${OUT} matches generation`, ok: current === doc, detail: current === undefined ? "missing" : current === doc ? "up to date" : "stale, run: node scripts/infra-map.ts" });
} else if (results.filter((r) => "ace".includes(r.id)).every((r) => r.ok)) {
  writeFileSync(ROOT + OUT, doc);
  results.push({ id: "w", name: `wrote ${OUT}`, ok: true, detail: `${doc.split("\n").length} lines` });
} else results.push({ id: "w", name: `wrote ${OUT}`, ok: false, detail: "not written: attribution/ownership/RPC checks failed" });

finish(results.map((r) => ({ status: r.ok ? "PASS" : "FAIL", name: `${r.id}  ${r.name}`, detail: r.detail })));
