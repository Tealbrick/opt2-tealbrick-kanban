// Makes an upgrade fixture (UPGRADE-SAFETY M7 style): boots an OLDER Task Board checkout on a fresh data directory (its own
// SDK applies its SDK schema and app migrations), seeds rows through that version's own store functions, then writes
//   test/upgrade/fixtures/kanban-<version>.sql          the whole app.db as SQL (schema + rows, SDK tables included)
//   test/upgrade/fixtures/kanban-<version>.issues.json  every issue as that version's toIssue() shows it
// test/upgrade/upgrade.test.ts loads the SQL, boots the CURRENT code on it and checks the issues read the same.
//
// Not run in CI. Usage (the old checkout needs `pnpm install` and `node --run kit`):
//   git worktree add --detach /tmp/kanban-0.1.14 origin/hotfix/0.1.14-node   (ostra's 0.1.14 = 0.1.13 code + Node image)
//   node test/upgrade/make-fixture.ts /tmp/kanban-0.1.14
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const old = resolve(process.argv[2] ?? "");
const out = new URL("./fixtures/", import.meta.url);
const version = String((JSON.parse(readFileSync(join(old, "package.json"), "utf8")) as { version: string }).version);
const load = async (rel: string) => (await import(pathToFileURL(join(old, rel)).href)) as Record<string, any>;

const sdk = await load("node_modules/@opt2-tealbrick/miniapp-sdk/dist/server/index.js");
const appMod = await load("src/app.ts");
const board = await load("src/board.ts");

const port = await new Promise<number>((done) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const a = s.address();
    s.close(() => done(typeof a === "object" && a ? a.port : 0));
  });
});
const dir = mkdtempSync(join(old, "..", `fixture-${version}-`));
const manifest = { ...appMod.manifest, runtime: { ...appMod.manifest.runtime, port } };
const running = await sdk.startApp(sdk.defineApp({ ...appMod.definition, manifest }), { TB_DATA_DIR: dir, TB_STANDALONE: "1", TB_LOG_LEVEL: "error" });
await running.stop();

const raw = new DatabaseSync(join(dir, "app.db"));
const db = {
  exec: (sql: string) => raw.exec(sql),
  prepare: (sql: string) => raw.prepare(sql),
  transaction<T>(fn: () => T): T {
    raw.exec("BEGIN");
    try {
      const r = fn();
      raw.exec("COMMIT");
      return r;
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
  },
};

// ---- seed: every app table (0001 projects/goals/issues/links/comments/documents/activity/agents/app_flags, 0004 apps,
// and on versions that have it 0005 issue_external + usage)
const t0 = Date.UTC(2026, 9, 20, 9, 0, 0);
let tick = 0;
const at = () => t0 + 60_000 * tick++;
const A = { kind: "agent", id: "agt_01JA0000000000000000000HEN", name: "Henry" };
const B = { kind: "agent", id: "agt_01JA0000000000000000000TMP", name: "Tempo" };
const OWNER = { kind: "owner", id: "per_01JA0000000000000000000MAR", name: "Owner" };
const APP = { kind: "app", id: "ins_01JA0000000000000000000OBS", name: "Observer" };
db.transaction(() => {
  board.upsertAgent(db, { id: A.id, name: A.name, mode: "free" }, at());
  board.upsertAgent(db, { id: B.id, name: B.name, mode: "bound" }, at());
  board.upsertApp?.(db, { id: APP.id, name: APP.name }, at());
  board.ensureOwnProject(db, A, at());
  board.ensureOwnProject(db, B, at());
  board.insertProject(db, { id: "prj_01JA0000000000000000000TEAM", name: "Team board", summary: "shared", shared: true, ownerAgent: null, team: true }, OWNER, at());
  // app_flags and the Team board came with 0.1.14-dev.1 (KT-1); 0.1.14 has neither
  if (raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'app_flags'").get())
    db.prepare("INSERT OR IGNORE INTO app_flags (key, value, set_at) VALUES ('team_board_made', '1', ?)").run(at());
  board.insertProject(db, { id: "prj_01JA0000000000000000000LNCH", name: "Launch", summary: "private", shared: false, ownerAgent: null }, OWNER, at());
});
const P = "prj_01JA0000000000000000000TEAM";
db.transaction(() => {
  const goal = board.createGoal(db, { project: P, title: "Ship 0.2", summary: "release", horizon: "short" }, OWNER, at());
  const spec = board.createIssue(db, { project: P, title: "Write the spec", summary: "doc", assignee: { kind: "agent", id: A.id }, goal: goal.id, priority: "high" }, OWNER, at());
  const build = board.createIssue(db, { project: P, title: "Build it", assignee: { kind: "agent", id: B.id }, dependsOn: [spec.id], template: "build" }, A, at());
  board.createIssue(db, { project: P, title: "Owner task", assignee: { kind: "owner", id: "owner" }, status: "backlog", priority: "low" }, OWNER, at());
  const blocked = board.createIssue(db, { project: P, title: "Needs a key", assignee: { kind: "agent", id: A.id } }, A, at());
  board.updateIssue(db, blocked.id, { status: "blocked", blockedReason: "Waiting for the API key" }, A, at());
  const review = board.createIssue(db, { project: P, title: "Review copy", assignee: { kind: "agent", id: B.id } }, APP, at());
  board.updateIssue(db, review.id, { status: "in_review" }, B, at());
  board.addComment(db, build.id, "Starting after the spec", B, at());
  board.addComment(db, spec.id, "Owner note", OWNER, at());
  board.linkDocument(db, spec.id, { id: "doc_01JA0000000000000000000SPC", title: "Spec draft" }, A, at());
  board.updateIssue(db, spec.id, { status: "done", result: "Spec in docs/spec.md" }, A, at());
  board.createIssue(db, { project: A.id, title: "Private step", status: "in_progress", assignee: { kind: "agent", id: A.id } }, A, at());
  board.createIssue(db, { project: "prj_01JA0000000000000000000LNCH", title: "Unassigned launch work" }, OWNER, at());
});
// 0005 (0.1.14-dev.1): an imported card and a usage report, through that version's own functions
const sync = await load("src/sync.ts").catch(() => null);
const usage = await load("src/usage.ts").catch(() => null);
if (sync?.importIssues) db.transaction(() => sync.importIssues(db, P, "trello", [{ externalId: "c1", title: "Imported card", status: "todo", url: "https://trello.com/c/c1", etag: "e1" }], A, at()));
if (usage?.recordUsage) {
  const t = at();
  const turn = { turn: "turn-0001", startedAt: new Date(t).toISOString(), endedAt: new Date(t + 30_000).toISOString(), harness: "claude-code", model: "claude", inputTokens: 1200, outputTokens: 300 };
  db.transaction(() => usage.recordUsage(db, A.id, turn, { projects: [P, A.id] }, t + 30_000));
}
raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");

// ---- dump
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  return `'${String(v).replaceAll("'", "''")}'`;
};
const objects = raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as { type: string; name: string; sql: string }[];
const lines = [`-- Task Board ${version} app.db (schema + rows), made by test/upgrade/make-fixture.ts. Do not edit by hand.`];
for (const o of objects.filter((x) => x.type === "table")) {
  lines.push(`${o.sql};`);
  // the throwaway standalone identity of this boot is not workspace data (a real update runs bridge-claimed)
  const skip = o.name === "tb_meta" ? " WHERE key NOT LIKE 'standalone%'" : "";
  for (const r of raw.prepare(`SELECT * FROM "${o.name}"${skip}`).all() as Record<string, unknown>[]) {
    const cols = Object.keys(r);
    lines.push(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => lit(r[c])).join(", ")});`);
  }
}
for (const o of objects.filter((x) => x.type !== "table")) lines.push(`${o.sql};`);
const issues = (raw.prepare("SELECT * FROM issues ORDER BY id").all() as Record<string, unknown>[]).map((r) => board.toIssue(db, r));
raw.close();
writeFileSync(new URL(`kanban-${version}.sql`, out), `${lines.join("\n")}\n`);
writeFileSync(new URL(`kanban-${version}.issues.json`, out), `${JSON.stringify(issues, null, 2)}\n`);
console.log(`fixture kanban-${version}: ${objects.length} schema objects, ${issues.length} issues (data dir ${dir})`);
