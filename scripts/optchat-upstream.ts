// Runs upstream pi-optchat's own memory test suite (jonaslsaa/pi-optchat@aae1caf test/memory.test.ts, vendored unchanged in
// tests/optchat/test/) against OUR src/optchat/memory.ts. Tests that exercise upstream modules we don't port (profiles,
// cache, transcript, inbox: pi coding-agent specifics) are listed as not applicable, never silently dropped.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = `${ROOT}tests/optchat/test/memory.test.ts`;
const GEN = `${ROOT}tests/optchat/test/.memory.selected.test.ts`;
const NOT_PORTED = ["lockProfile", "splitView", "cachePayload", "logMessage", "buildContext", "boundedMessage", "Inbox"];

const source = readFileSync(SRC, "utf8");
const lines = source.split("\n");
const firstTest = lines.findIndex((l) => l.startsWith("test("));
const header = lines.slice(0, firstTest).filter((l) => !/from '\.\.\/src\/(profiles|cache|transcript|inbox)\.ts'/.test(l));
// Top-level tests start at column 0 with `test(`; everything up to the next one belongs to it.
const starts = lines.flatMap((l, i) => (l.startsWith("test(") ? [i] : []));
const blocks = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length));
const name = (b: string[]) => b[0].match(/^test\((['"`])(.*?)\1/)?.[2] ?? b[0];
const skipped = blocks.filter((b) => NOT_PORTED.some((id) => b.join("\n").includes(id)));
const kept = blocks.filter((b) => !skipped.includes(b));
mkdirSync(`${ROOT}tests/optchat/test`, { recursive: true });
writeFileSync(GEN, [...header, ...kept.flat()].join("\n"));

console.log(`upstream memory tests: ${blocks.length} total, ${kept.length} run against our Memory, ${skipped.length} not applicable:`);
for (const b of skipped) console.log(`  n/a  ${name(b)}  (uses ${NOT_PORTED.filter((id) => b.join("\n").includes(id)).join(", ")})`);
const run = spawnSync(process.execPath, ["--experimental-transform-types", "--no-warnings", "--test", "--test-reporter=spec", GEN], { cwd: `${ROOT}tests/optchat`, encoding: "utf8" });
process.stdout.write(run.stdout.split("\n").filter((l) => /^\s*(✔|✖|ℹ (tests|pass|fail))/.test(l)).join("\n") + "\n");
if (run.status !== 0) process.stdout.write(run.stdout.split("\n").filter((l) => /✖|Error|expected|actual|at .*memory/.test(l)).slice(0, 80).join("\n") + "\n" + run.stderr.slice(-3000));
process.exit(run.status ?? 1);
