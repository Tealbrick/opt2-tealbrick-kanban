// 0.1.14: outside-tracker import + sync back (C331(6)), token usage per issue as information only (C331(7), C327),
// and the Team board (demo gap 7). Handlers run like the SDK runs them: input and output validated against the manifest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgainstSchema } from "@opt2-tealbrick/manifest";
import type { HandlerSpec } from "@opt2-tealbrick/miniapp-sdk";
import { ensureTeamBoard, handlers, manifest } from "../src/app.ts";
import { insertProject, upsertAgent } from "../src/board.ts";
import { CRUD, ctxFor, type FakeCaller, migratedDb } from "./helpers.ts";

const H = handlers as Record<string, HandlerSpec<any, any>>;
async function call(op: string, input: unknown, ctx: ReturnType<typeof ctxFor>): Promise<any> {
  const view = manifest.operations.find((o) => o.id === op);
  assert.ok(view, `unknown op ${op}`);
  const vin = validateAgainstSchema(view.input as never, input as never);
  assert.ok(vin.ok, `${op} input invalid: ${JSON.stringify(vin.ok ? null : vin.errors)}`);
  const out = await (H[op] as HandlerSpec<any, any>).run(input as never, ctx);
  const vout = validateAgainstSchema(view.output as never, out as never);
  assert.ok(vout.ok, `${op} output invalid: ${JSON.stringify(vout.ok ? null : vout.errors)}`);
  return out;
}

const A: FakeCaller = { type: "agent", id: "agt_01J00000000000000000000AAA", name: "Agent A" };
const B: FakeCaller = { type: "agent", id: "agt_01J00000000000000000000BBB", name: "Agent B" };
const OWNER: FakeCaller = { type: "person", id: "per_01J00000000000000000000OWN", name: "Owner" };
const ownerActor = { kind: "owner" as const, id: OWNER.id, name: "Owner" };

function setup() {
  const db = migratedDb();
  upsertAgent(db, { id: A.id, name: A.name, mode: "free" });
  upsertAgent(db, { id: B.id, name: B.name, mode: "free" });
  insertProject(db, { id: "prj_team", name: "Team", shared: true, ownerAgent: null }, ownerActor);
  const a = ctxFor(db, A, { prj_team: CRUD.contribute, [A.id]: CRUD.manage });
  const b = ctxFor(db, B, { prj_team: CRUD.contribute, [B.id]: CRUD.manage });
  return { db, a, b, owner: ctxFor(db, OWNER) };
}

const card = (n: number, extra: Record<string, unknown> = {}) => ({
  externalId: `trl_${n}`,
  title: `Card ${n}`,
  url: `https://trello.com/c/${n}`,
  etag: "v1",
  ...extra,
});

test("import: 40 cards make 40 issues with a source ref; a second import makes none (KS-1, KS-2)", async () => {
  const { a, owner } = setup();
  const items = Array.from({ length: 40 }, (_, i) => card(i + 1, i < 5 ? { status: "backlog" } : {}));
  const first = await call("issues_import", { project: "prj_team", system: "trello", items: items.slice(0, 20) }, a);
  const second = await call("issues_import", { project: "prj_team", system: "trello", items: items.slice(20) }, a);
  assert.equal([...first.results, ...second.results].filter((r: any) => r.outcome === "created").length, 40);
  const view = await call("board_view", { project: "prj_team" }, owner);
  assert.equal(view.issues.length, 40);
  const one = view.issues.find((i: any) => i.title === "Card 1");
  assert.deepEqual(one.external, { system: "trello", id: "trl_1", url: "https://trello.com/c/1", syncedStatus: "backlog", syncPending: false, syncError: null });
  assert.equal(one.status, "backlog");
  assert.equal(one.createdBy.name, "Agent A");

  const again = await call("issues_import", { project: "prj_team", system: "trello", items: items.slice(0, 20) }, a);
  assert.ok(again.results.every((r: any) => r.outcome === "unchanged"));
  assert.equal((await call("board_view", { project: "prj_team" }, owner)).issues.length, 40);
  // same ref in another system is another card
  const other = await call("issues_import", { project: "prj_team", system: "asana", items: [card(1)] }, a);
  assert.equal(other.results[0].outcome, "created");
});

test("import: changed etag updates title; source status applies only when nobody moved the card here (KS-3)", async () => {
  const { a, b } = setup();
  const [c1, c2] = (await call("issues_import", { project: "prj_team", system: "trello", items: [card(1), card(2)] }, a)).results;
  const up = await call("issues_import", { project: "prj_team", system: "trello", items: [card(1, { title: "Card 1 (renamed)", etag: "v2", status: "in_progress" })] }, a);
  assert.equal(up.results[0].outcome, "updated");
  let got = await call("issue_get", { issue: c1.issue }, b);
  assert.equal(got.issue.title, "Card 1 (renamed)");
  assert.equal(got.issue.status, "in_progress");
  assert.equal(got.issue.external.syncedStatus, "in_progress");

  // someone moves card 2 here, then the source changes its status too
  await call("issue_update", { issue: c2.issue, status: "in_review" }, b);
  const conflict = await call("issues_import", { project: "prj_team", system: "trello", items: [card(2, { etag: "v2", status: "blocked" })] }, a);
  assert.equal(conflict.results[0].outcome, "conflict");
  got = await call("issue_get", { issue: c2.issue }, b);
  assert.equal(got.issue.status, "in_review", "the board keeps its status");
  assert.equal(got.issue.external.syncedStatus, "todo");
  const log = await call("activity_list", { issue: c2.issue }, b);
  assert.ok(log.activity.some((e: any) => e.kind === "sync_conflict" && /trello says blocked/.test(e.summary)));
});

test("sync back: done cards are pending until acknowledged; an error keeps them pending (KS-5, KS-6)", async () => {
  const { a, b, owner } = setup();
  const res = (await call("issues_import", { project: "prj_team", system: "trello", items: [card(1), card(2), card(3)] }, a)).results;
  await call("issue_complete", { issue: res[0].issue, result: "shipped" }, b);
  await call("issue_complete", { issue: res[1].issue, result: "shipped" }, b);
  await call("issue_update", { issue: res[2].issue, status: "in_progress" }, b);
  const pending = await call("sync_pending", { system: "trello" }, a);
  assert.deepEqual(pending.issues.map((i: any) => i.id).sort(), [res[0].issue, res[1].issue].sort());
  assert.equal((await call("sync_pending", { all: true }, a)).issues.length, 3);
  assert.equal((await call("board_view", { project: "prj_team" }, owner)).syncPending.prj_team, 3);

  const ok = await call("issue_sync_ack", { issue: res[0].issue, status: "done", etag: "v9" }, a);
  assert.equal(ok.issue.external.syncPending, false);
  const failed = await call("issue_sync_ack", { issue: res[1].issue, status: "done", error: "Trello said 401" }, a);
  assert.equal(failed.issue.external.syncPending, true);
  assert.equal(failed.issue.external.syncError, "Trello said 401");
  assert.deepEqual(
    (await call("sync_pending", {}, a)).issues.map((i: any) => i.id),
    [res[1].issue],
  );
  // re-import after the ack: same etag = unchanged, the done status stays
  assert.equal((await call("issues_import", { project: "prj_team", system: "trello", items: [card(1, { etag: "v9", status: "done" })] }, a)).results[0].outcome, "unchanged");
  // a normal issue cannot be acknowledged
  const plain = await call("issue_create", { project: "prj_team", title: "plain" }, a);
  await assert.rejects(call("issue_sync_ack", { issue: plain.issue.id, status: "done" }, a), { code: "not_external" });
});

test("import/sync access: unreadable project = not found; read-only cannot import; bad system or url refused (KS-7)", async () => {
  const { db, a } = setup();
  insertProject(db, { id: "prj_secret", name: "Secret", shared: false, ownerAgent: null }, ownerActor);
  insertProject(db, { id: "prj_ro", name: "RO", shared: true, ownerAgent: null }, ownerActor);
  const ro = ctxFor(db, A, { prj_ro: CRUD.read, [A.id]: CRUD.manage });
  await assert.rejects(call("issues_import", { project: "prj_secret", system: "trello", items: [card(1)] }, a), { code: "not_found" });
  await assert.rejects(call("issues_import", { project: "prj_ro", system: "trello", items: [card(1)] }, ro), { code: "scope_denied" });
  await assert.rejects(call("sync_pending", { project: "prj_secret" }, a), { code: "not_found" });
  await assert.rejects(call("issues_import", { project: "prj_team", system: "trello", items: [card(1, { url: "http://trello.com/c/1" })] }, a), { code: "url_invalid" });
  await assert.rejects(H.issues_import?.run({ project: "prj_team", system: "Trello", items: [card(1)] } as never, a) as Promise<unknown>, { code: "system_invalid" });
  // default project = the caller's own
  const own = await call("issues_import", { system: "linear", items: [card(7)] }, a);
  assert.equal(own.project, A.id);
});

test("deleting an imported issue removes its ref: the next import creates it again (KS-8)", async () => {
  const { a } = setup();
  const [c] = (await call("issues_import", { project: "prj_team", system: "trello", items: [card(1)] }, a)).results;
  await call("issue_delete", { issue: c.issue }, ctxFor(a.db, A, { prj_team: CRUD.manage, [A.id]: CRUD.manage }));
  const again = await call("issues_import", { project: "prj_team", system: "trello", items: [card(1)] }, a);
  assert.equal(again.results[0].outcome, "created");
  assert.notEqual(again.results[0].issue, c.issue);
});

const turn = (key: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  turn: key,
  startedAt: new Date(start).toISOString(),
  endedAt: new Date(end).toISOString(),
  harness: "claude",
  model: "claude-opus-5-5",
  inputTokens: 1000,
  outputTokens: 200,
  cacheCreationInputTokens: 50,
  cacheReadInputTokens: 5000,
  costUsd: 0.12,
  numTurns: 3,
  ...extra,
});

test("usage: a turn that worked on issues is split over them; repeat is a duplicate (KU-1, KU-2 activity)", async () => {
  const { a, owner } = setup();
  const i1 = (await call("issue_create", { project: "prj_team", title: "one" }, a)).issue.id;
  const i2 = (await call("issue_create", { project: "prj_team", title: "two" }, a)).issue.id;
  const now = Date.now();
  const r = await call("usage_report", turn("t1", now - 60_000, now + 1000), a);
  assert.equal(r.rule, "activity");
  assert.deepEqual(r.issues.sort(), [i1, i2].sort());
  const dup = await call("usage_report", turn("t1", now - 60_000, now + 1000), a);
  assert.equal(dup.duplicate, true);
  const u1 = (await call("issue_get", { issue: i1 }, a)).usage;
  assert.deepEqual(u1, { turns: 1, inputTokens: 500, outputTokens: 100, cacheCreationInputTokens: 25, cacheReadInputTokens: 2500, costUsd: 0.06 });
  const view = await call("board_view", { project: "prj_team" }, owner);
  assert.equal(view.usage.byProject.prj_team.inputTokens, 1000);
  assert.equal(view.usage.byIssue[i2].costUsd, 0.06);
  assert.deepEqual((await call("board_issue", { issue: i2 }, owner)).usage.turns, 1);
});

test("usage: explicit issue wins; then the single in_progress issue; else unattributed per agent (KU-2)", async () => {
  const { db, a, b, owner } = setup();
  const i1 = (await call("issue_create", { project: "prj_team", title: "named", assignee: "me" }, a)).issue.id;
  const t0 = Date.now() + 3_600_000; // a later window with no activity
  const named = await call("usage_report", turn("t-explicit", t0, t0 + 1000, { issue: i1 }), a);
  assert.equal(named.rule, "explicit");
  // an issue the caller cannot read is ignored, not an error
  insertProject(db, { id: "prj_secret", name: "Secret", shared: false, ownerAgent: null }, ownerActor);
  const hidden = (await call("board_issue_create", { project: "prj_secret", title: "hidden" }, owner)).issue.id;
  await call("issue_update", { issue: i1, status: "in_progress" }, a);
  const t1 = t0 + 7_200_000;
  const fallback = await call("usage_report", turn("t-hidden", t1, t1 + 1000, { issue: hidden }), a);
  assert.equal(fallback.rule, "in_progress");
  assert.deepEqual(fallback.issues, [i1]);
  const none = await call("usage_report", turn("t-none", t1, t1 + 1000, { costUsd: undefined }), b);
  assert.equal(none.rule, "none");
  const view = await call("board_view", { project: "all" }, owner);
  assert.equal(view.project, "all");
  assert.deepEqual(view.usage.unattributed[B.id], { turns: 1, inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 50, cacheReadInputTokens: 5000, costUsd: null });
  assert.equal(view.usage.byIssue[i1].turns, 2);
  assert.equal(view.usage.byIssue[hidden], undefined);
});

test("usage is information only: huge numbers change no answer, no warning, no hold (KU-4, C327)", async () => {
  const { a } = setup();
  const i1 = (await call("issue_create", { project: "prj_team", title: "costly", assignee: "me" }, a)).issue.id;
  const before = await call("issue_get", { issue: i1 }, a);
  const now = Date.now();
  const r = await call("usage_report", turn("big", now - 1000, now + 1000, { inputTokens: 900_000_000_000, outputTokens: 900_000_000_000, costUsd: 999_999 }), a);
  assert.deepEqual(Object.keys(r).sort(), ["duplicate", "issues", "rule"]);
  const after = await call("issue_get", { issue: i1 }, a);
  assert.deepEqual(after.issue, before.issue, "the issue itself is unchanged");
  assert.equal(after.usage.costUsd, 999_999);
  // writes still work exactly as before
  assert.equal((await call("issue_complete", { issue: i1, result: "done anyway" }, a)).issue.status, "done");
  assert.equal(H.usage_report?.holdView, undefined);
  const op = manifest.operations.find((o) => o.id === "usage_report");
  assert.equal(op?.effect, "write");
  assert.equal(op?.holdFamily, undefined);
});

test("usage: apps cannot report; deleting the issue removes its usage (KU-5, KU-6)", async () => {
  const { db, a } = setup();
  const app = ctxFor(db, { type: "app", id: "ins_01J000000000000000000APP0", name: "Evolution" }, { prj_team: CRUD.contribute });
  const now = Date.now();
  await assert.rejects(H.usage_report?.run(turn("x", now, now) as never, app) as Promise<unknown>, { code: "agents_only" });
  const i1 = (await call("issue_create", { project: "prj_team", title: "gone soon" }, a)).issue.id;
  await call("usage_report", turn("t", now - 1000, now + 1000), a);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM usage_turns").get()?.n), 1);
  await call("board_issue_delete", { issue: i1 }, ctxFor(db, OWNER));
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM usage_turns").get()?.n), 0, "the turn counted only for the deleted issue is gone");
  await assert.rejects(H.usage_report?.run(turn("bad", now, now - 5) as never, a) as Promise<unknown>, { code: "endedAt_invalid" });
});

test("Team board: made once when no shared project exists; never again after delete; ranked after own (KT-1, KT-2)", async () => {
  const db = migratedDb();
  const made: unknown[] = [];
  const scopes = { instances: { create: async (...x: unknown[]) => made.push(x), list: async () => [] } } as never;
  await ensureTeamBoard(db, scopes);
  const team = db.prepare("SELECT * FROM projects WHERE team = 1").get();
  assert.equal(team?.name, "Team board");
  assert.equal(Number(team?.shared), 1);
  assert.deepEqual(made, [["project", team?.id, "Team board", { shared: true }]]);
  await ensureTeamBoard(db, scopes);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM projects").get()?.n), 1, "a second start makes no second board");
  assert.equal(made.length, 2, "the scope instance is declared again on each start");

  upsertAgent(db, { id: A.id, name: A.name, mode: "free" });
  insertProject(db, { id: A.id, name: "Agent A work", shared: false, ownerAgent: A.id }, ownerActor);
  insertProject(db, { id: "prj_aaa", name: "AAA shared", shared: true, ownerAgent: null }, ownerActor);
  const a = ctxFor(db, A, { [String(team?.id)]: CRUD.contribute, [A.id]: CRUD.manage, prj_aaa: CRUD.contribute });
  assert.deepEqual(
    (await call("projects_list", {}, a)).projects.map((p: any) => p.id),
    [A.id, team?.id, "prj_aaa"],
  );
  assert.equal((await call("projects_list", {}, a)).projects[1].team, true);

  await call("board_project_delete", { project: String(team?.id) }, ctxFor(db, OWNER));
  await ensureTeamBoard(db, scopes);
  assert.equal(db.prepare("SELECT 1 FROM projects WHERE team = 1").get(), undefined, "an owner who deleted it does not get it back");
});

test("Team board: an install that already has a shared project gets none (KT-1, QA-KT-3)", async () => {
  const db = migratedDb();
  insertProject(db, { id: "prj_old", name: "Old shared", shared: true, ownerAgent: null }, ownerActor);
  const made: unknown[] = [];
  await ensureTeamBoard(db, { instances: { create: async (...x: unknown[]) => made.push(x), list: async () => [] } } as never);
  assert.equal(db.prepare("SELECT 1 FROM projects WHERE team = 1").get(), undefined);
  assert.equal(made.length, 0);
});
