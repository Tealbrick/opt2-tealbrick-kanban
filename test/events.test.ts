// App events (C274 S4, DONE-DEFINITION §1.1 and §3.1): issue.assigned, issue.unblocked and issue.commented go to agents only,
// never to the author, once per change, inside the change's transaction, with a payload that matches the declaration.
// The fake outbox (helpers.withEvents) validates every emit like the SDK and keeps rows in the same database.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HandlerSpec } from "@opt2-tealbrick/miniapp-sdk";
import { handlers, manifest } from "../src/app.ts";
import { insertProject, upsertAgent } from "../src/board.ts";
import { type BoardEvent, recipients, SUMMARY_MAX, summaryOf, toEmit } from "../src/events.ts";
import { CRUD, ctxFor, type FakeCaller, migratedDb, withEvents } from "./helpers.ts";

const H = handlers as Record<string, HandlerSpec<any, any>>;
const A: FakeCaller = { type: "agent", id: "agt_01J00000000000000000000AAA", name: "Agent A" };
const B: FakeCaller = { type: "agent", id: "agt_01J00000000000000000000BBB", name: "Agent B" };
const C: FakeCaller = { type: "agent", id: "agt_01J00000000000000000000CCC", name: "Agent C" };
const OWNER: FakeCaller = { type: "person", id: "per_01J00000000000000000000OWN", name: "Owner" };
const OBSERVER: FakeCaller = { type: "app", id: "ins_01J00000000000000000000OBS", name: "Observer" };
const P = "prj_team";

function board() {
  const db = migratedDb();
  for (const x of [A, B, C]) upsertAgent(db, { id: x.id, name: x.name, mode: "free" });
  insertProject(db, { id: P, name: "Team", shared: true, ownerAgent: null }, { kind: "owner", id: OWNER.id, name: "Owner" });
  const as = (who: FakeCaller) => withEvents(ctxFor(db, who, { [P]: CRUD.manage, [who.id]: CRUD.manage }), manifest);
  return { db, as };
}
const run = (op: string, input: unknown, ctx: unknown) => (H[op] as HandlerSpec<any, any>).run(input as never, ctx as never) as Promise<any>;

test("manifest declares exactly the three Task Board events (targeted, scoped on issue_get, ids and enums only)", () => {
  const ev = manifest.events ?? [];
  assert.deepEqual(
    ev.map((e) => e.name),
    ["issue.assigned", "issue.unblocked", "issue.commented"],
  );
  const issueGet = manifest.operations.find((o) => o.id === "issue_get");
  assert.equal(issueGet?.scopeType, "project");
  for (const e of ev) {
    assert.equal(e.audience, "target", e.name);
    assert.equal(e.visibleWith, "issue_get", e.name);
    const s = e.payloadSchema as { additionalProperties?: boolean; properties?: Record<string, { type?: string; enum?: unknown[] }> };
    assert.equal(s.additionalProperties, false, e.name);
    assert.equal(s.properties?.summary, undefined, `${e.name}: no summary property (M-EV-4)`);
    for (const [k, p] of Object.entries(s.properties ?? {})) assert.ok(p.enum || p.type === "string" || p.type === "object", `${e.name}.${k} is an id, an enum or the by-object`);
  }
});

test("issue.assigned: create for another agent wakes it once; self, owner and unassigned wake nobody", async () => {
  const { as } = board();
  const a = as(A);
  const made = await run("issue_create", { project: P, title: "Ship the release notes", assignee: B.id }, a);
  const [e, ...rest] = a.emitted();
  assert.equal(rest.length, 0);
  assert.equal(e?.name, "issue.assigned");
  assert.deepEqual(e?.to, [B.id]);
  assert.deepEqual(e?.subject, { kind: "issue", id: made.issue.id });
  assert.equal(e?.instanceId, P);
  assert.deepEqual(e?.data, { projectId: P, status: "todo", reason: "created", by: { kind: "agent", id: A.id } });
  assert.equal(e?.summary, "Ship the release notes");
  assert.equal(e?.untrusted, true);

  await run("issue_create", { project: P, title: "mine", assignee: "me" }, a);
  await run("issue_create", { project: P, title: "for the owner", assignee: "owner" }, a);
  await run("issue_create", { project: P, title: "nobody" }, a);
  assert.equal(a.emitted().length, 1, "no event to the author, to the owner or for an unassigned issue");
});

test("issue.assigned: the owner and an app caller assign too (by = owner / app)", async () => {
  const { as } = board();
  const owner = as(OWNER);
  await run("board_issue_create", { project: P, title: "From the board", assignee: C.id }, owner);
  assert.deepEqual(owner.emitted()[0]?.data.by, { kind: "owner", id: OWNER.id });
  assert.deepEqual(owner.emitted()[0]?.to, [C.id]);
  const app = as(OBSERVER);
  await run("issue_create", { project: P, title: "From an app", assignee: B.id }, app);
  assert.deepEqual(app.emitted().at(-1)?.data.by, { kind: "app", id: OBSERVER.id });
});

test("issue.assigned on reassignment only; other edits and unassign send nothing", async () => {
  const { as } = board();
  const a = as(A);
  const i = (await run("issue_create", { project: P, title: "t", assignee: B.id }, a)).issue;
  await run("issue_update", { issue: i.id, title: "t2", priority: "high" }, a);
  assert.equal(a.emitted().length, 1, "no event without an assignee change");
  await run("issue_update", { issue: i.id, assignee: C.id }, a);
  const e = a.emitted().at(-1);
  assert.deepEqual(e?.to, [C.id]);
  assert.equal(e?.data.reason, "reassigned");
  assert.equal(e?.summary, "t2");
  await run("issue_update", { issue: i.id, assignee: null }, a);
  await run("issue_update", { issue: i.id, assignee: "owner" }, a);
  assert.equal(a.emitted().length, 2);
  // A → B → A: each assignment is its own event (default ULID keys, never merged)
  const owner = as(OWNER);
  await run("board_issue_update", { issue: i.id, assignee: A.id }, owner);
  await run("board_issue_update", { issue: i.id, assignee: B.id }, owner);
  await run("board_issue_update", { issue: i.id, assignee: A.id }, owner);
  assert.deepEqual(
    owner.emitted().slice(-3).map((x) => x.to[0]),
    [A.id, B.id, A.id],
  );
});

test("issue.unblocked: leaving blocked tells the assignee (status_change); its own unblock and a new assignee do not double", async () => {
  const { as } = board();
  const a = as(A);
  const owner = as(OWNER);
  const i = (await run("issue_create", { project: P, title: "Needs a key", assignee: B.id }, a)).issue;
  await run("issue_block", { issue: i.id, reason: "Need the API key" }, as(B));
  const before = owner.emitted().length;
  await run("board_issue_update", { issue: i.id, status: "todo" }, owner);
  const e = owner.emitted().at(-1);
  assert.equal(owner.emitted().length, before + 1);
  assert.equal(e?.name, "issue.unblocked");
  assert.deepEqual(e?.to, [B.id]);
  assert.deepEqual(e?.data, { projectId: P, status: "todo", cause: "status_change" });

  // the assignee unblocks its own issue: no event
  await run("issue_block", { issue: i.id, reason: "again" }, as(B));
  const n = owner.emitted().length;
  await run("issue_update", { issue: i.id, status: "in_progress" }, as(B));
  assert.equal(owner.emitted().length, n);

  // blocked → todo AND reassigned to C in one change: exactly one event, issue.assigned to C
  await run("issue_block", { issue: i.id, reason: "third time" }, as(B));
  const m = owner.emitted().length;
  await run("board_issue_update", { issue: i.id, status: "todo", assignee: C.id }, owner);
  assert.equal(owner.emitted().length, m + 1);
  assert.equal(owner.emitted().at(-1)?.name, "issue.assigned");
  assert.deepEqual(owner.emitted().at(-1)?.to, [C.id]);
});

test("issue.unblocked: a finished, unlinked or deleted dependency wakes the dependent's assignee", async () => {
  const { as } = board();
  const a = as(A);
  const dep = (await run("issue_create", { project: P, title: "Spec" }, a)).issue;
  const work = (await run("issue_create", { project: P, title: "Build", assignee: B.id, dependsOn: [dep.id] }, a)).issue;
  const n = a.emitted().length;
  await run("issue_complete", { issue: dep.id, result: "done" }, a);
  const e = a.emitted().at(-1);
  assert.equal(a.emitted().length, n + 1);
  assert.equal(e?.name, "issue.unblocked");
  assert.deepEqual(e?.subject, { kind: "issue", id: work.id });
  assert.deepEqual(e?.to, [B.id]);
  assert.deepEqual(e?.data, { projectId: P, status: "todo", cause: "dependency_done", unblockedBy: dep.id });
  assert.equal(e?.summary, "Build");

  // the assignee finishes the dependency itself: nobody is told
  const dep2 = (await run("issue_create", { project: P, title: "Spec 2" }, a)).issue;
  await run("issue_create", { project: P, title: "Build 2", assignee: B.id, dependsOn: [dep2.id] }, a);
  const m = a.emitted().length;
  await run("issue_complete", { issue: dep2.id, result: "done" }, as(B));
  assert.equal(a.emitted().length, m);

  // unlink and delete
  const dep3 = (await run("issue_create", { project: P, title: "Spec 3" }, a)).issue;
  const w3 = (await run("issue_create", { project: P, title: "Build 3", assignee: C.id, dependsOn: [dep3.id] }, a)).issue;
  await run("issue_unlink", { issue: w3.id, dependsOn: dep3.id }, a);
  assert.deepEqual(a.emitted().at(-1)?.data, { projectId: P, status: "todo", cause: "dependency_removed", unblockedBy: dep3.id });
  const dep4 = (await run("issue_create", { project: P, title: "Spec 4" }, a)).issue;
  const w4 = (await run("issue_create", { project: P, title: "Build 4", assignee: C.id, dependsOn: [dep4.id] }, a)).issue;
  const owner = as(OWNER);
  await run("board_issue_delete", { issue: dep4.id }, owner);
  const d = owner.emitted().at(-1);
  assert.deepEqual(d?.subject, { kind: "issue", id: w4.id });
  assert.deepEqual(d?.data, { projectId: P, status: "todo", cause: "dependency_removed", unblockedBy: dep4.id });
});

test("issue.commented: assignee + creator (agents), minus the author, deduplicated; summary names the author", async () => {
  const { as } = board();
  const a = as(A);
  const i = (await run("issue_create", { project: P, title: "Pair on it", assignee: B.id }, a)).issue;
  const n0 = a.emitted().length;
  const c = await run("issue_comment_add", { issue: i.id, body: "  I found\nthe root cause  " }, as(C));
  const e = a.emitted().at(-1);
  assert.equal(a.emitted().length, n0 + 1);
  assert.equal(e?.name, "issue.commented");
  assert.deepEqual(e?.to, [B.id, A.id]);
  assert.deepEqual(e?.data, { projectId: P, commentId: c.comment.id, by: { kind: "agent", id: C.id } });
  assert.equal(e?.summary, "Agent C: I found the root cause");
  assert.equal(e?.untrusted, true);

  await run("issue_comment_add", { issue: i.id, body: "on it" }, as(B));
  assert.deepEqual(a.emitted().at(-1)?.to, [A.id], "the assignee comments: only the creator");
  await run("issue_comment_add", { issue: i.id, body: "thanks" }, a);
  assert.deepEqual(a.emitted().at(-1)?.to, [B.id], "the creator comments: only the assignee");

  const own = (await run("issue_create", { project: P, title: "solo", assignee: "me" }, a)).issue;
  const n = a.emitted().length;
  await run("issue_comment_add", { issue: own.id, body: "note to self" }, a);
  assert.equal(a.emitted().length, n, "creator = assignee = author: nobody");
  const owner = as(OWNER);
  await run("board_comment_add", { issue: own.id, body: "x".repeat(4000) }, owner);
  const big = owner.emitted().at(-1);
  assert.deepEqual(big?.to, [A.id]);
  assert.ok((big?.summary ?? "").length <= SUMMARY_MAX);
  assert.ok(big?.summary?.startsWith("Owner: xxx"));

  // an issue the owner created and assigned to the owner: no agent involved, no event
  const mine = (await run("board_issue_create", { project: P, title: "owner only", assignee: "owner" }, owner)).issue;
  const m = owner.emitted().length;
  await run("issue_comment_add", { issue: mine.id, body: "hi" }, as(B));
  assert.equal(owner.emitted().length, m, "persons and apps are never recipients");
});

test("a failed change emits nothing (the outbox row shares the transaction)", async () => {
  const { as } = board();
  const a = as(A);
  const dep = (await run("issue_create", { project: P, title: "dep" }, a)).issue;
  const i = (await run("issue_create", { project: P, title: "t", assignee: B.id }, a)).issue;
  const n = a.emitted().length;
  // goal_invalid is thrown before any write; link_invalid is thrown inside the transaction AFTER the issue row was written
  await assert.rejects(run("issue_update", { issue: i.id, assignee: C.id, goal: "gol_missing" }, a), { code: "goal_invalid" });
  await assert.rejects(run("issue_create", { project: P, title: "x", assignee: C.id, dependsOn: [dep.id, "iss_missing"] }, a), { code: "link_invalid" });
  assert.equal(a.emitted().length, n);
  assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM issues WHERE title = 'x'").get()?.n, 0);
  // a sink call inside a transaction that then rolls back leaves no row either
  assert.throws(() =>
    a.db.transaction(() => {
      a.emit?.("issue.assigned", { projectId: P, status: "todo", reason: "created", by: { kind: "agent", id: A.id } }, { subject: { kind: "issue", id: i.id }, to: [B.id as never], instanceId: P });
      throw new Error("roll back");
    }),
  );
  assert.equal(a.emitted().length, n);
});

test("issues_import: a card moved out of blocked or completed by the source wakes the assignee", async () => {
  const { as } = board();
  const a = as(A);
  const r = await run("issues_import", { project: P, system: "trello", items: [{ externalId: "c1", title: "Card", status: "blocked" }, { externalId: "c2", title: "Dep" }] }, a);
  assert.equal(a.emitted().length, 0, "import items name no assignee");
  const card = r.results[0].issue;
  await run("issue_update", { issue: card, assignee: B.id }, as(OWNER));
  const n = a.emitted().length;
  await run("issues_import", { project: P, system: "trello", items: [{ externalId: "c1", title: "Card", status: "todo" }] }, a);
  assert.equal(a.emitted().length, n + 1);
  assert.deepEqual(a.emitted().at(-1)?.data, { projectId: P, status: "todo", cause: "status_change" });
  assert.deepEqual(a.emitted().at(-1)?.to, [B.id]);
});

test("deleting a project purges its events in the delete transaction (agent op and owner op)", async () => {
  const { db, as } = board();
  insertProject(db, { id: "prj_gone", name: "Gone", shared: false, ownerAgent: null }, { kind: "owner", id: OWNER.id, name: "Owner" });
  const owner = as(OWNER);
  await run("board_project_delete", { project: "prj_gone" }, owner);
  assert.deepEqual(owner.purged(), ["prj_gone"]);
  const a = as(A);
  await run("project_delete", { project: P }, a);
  assert.deepEqual(a.purged(), ["prj_gone", P]);
});

test("production events_probe refuses every call and writes nothing", async () => {
  const { as } = board();
  const owner = as(OWNER);
  await assert.rejects(run("events_probe", { case: "emit", key: "tbconf-123456" }, owner), { code: "not_found" });
  assert.equal(owner.emitted().length, 0);
});

test("recipients / toEmit: agents only, minus the actor, deduplicated, malformed ids dropped; summary ≤ 280", () => {
  const actor = { kind: "agent" as const, id: A.id, name: "A" };
  assert.deepEqual(
    recipients(
      [
        { kind: "agent", id: B.id },
        { kind: "owner", id: "owner" },
        { kind: "app", id: OBSERVER.id },
        { kind: "agent", id: A.id },
        { kind: "agent", id: B.id },
        { kind: "agent", id: "agt_bad" },
      ],
      actor,
    ),
    [B.id],
  );
  const ev: BoardEvent = { type: "assigned", issue: "iss_1", project: P, title: "y".repeat(500), status: "todo", reason: "created", to: { kind: "agent", id: A.id } };
  assert.equal(toEmit(ev, actor), null, "never to the author");
  assert.equal(toEmit(ev, { kind: "owner", id: OWNER.id, name: "Owner" })?.summary.length, SUMMARY_MAX);
  assert.equal(summaryOf("a\n\n b"), "a b");
});
