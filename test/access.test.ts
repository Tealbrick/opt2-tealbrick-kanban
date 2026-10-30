// C380 B6 (tb.access/1, Task Board): the guard (one quiet-on-good and one fire-on-bad test per caller case), the list (kinds,
// paging, subject filter, notShown, digest), nothing written by the op, and the conformance strip.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgainstSchema, validateManifest } from "@opt2-tealbrick/manifest";
import type { HandlerSpec } from "@opt2-tealbrick/miniapp-sdk";
import { conformanceManifest, GUARDED_OPS } from "../conformance.strip.ts";
import { digestOf, GOVERNANCE_PRODUCT, TARGET } from "../src/access.ts";
import { handlers, manifest } from "../src/app.ts";
import { createIssue, insertProject, upsertAgent } from "../src/board.ts";
import { ctxFor, migratedDb } from "./helpers.ts";

const H = handlers as Record<string, HandlerSpec<any, any>>;
const A = { id: "agt_01J00000000000000000000AAA", name: "Agent A" };
const B = { id: "agt_01J00000000000000000000BBB", name: "Agent B" };
const OWNER = { kind: "owner" as const, id: "per_01J00000000000000000000OWN", name: "Owner" };

type Caller = { type: string; id: string; name: string; product?: string; listed?: boolean };
const fleet: Caller = { type: "app", id: "ins_01J00000000000000000000FLT", name: "Governance", product: GOVERNANCE_PRODUCT, listed: true };

/** Runs access_list like the SDK does: input and output are validated against the manifest schemas. */
async function list(db: ReturnType<typeof migratedDb>, input: unknown, caller: Caller = fleet, opts: { skipSchema?: boolean } = {}): Promise<any> {
  const view = manifest.operations.find((o) => o.id === "access_list");
  assert.ok(view, "access_list is in the manifest");
  // the SDK refuses a call that breaks the schema before any handler runs; `skipSchema` reaches the handler's own checks (defence in depth)
  const vin = validateAgainstSchema(view.input as never, input as never);
  if (!opts.skipSchema) assert.ok(vin.ok, `input invalid: ${JSON.stringify(vin.ok ? null : vin.errors)}`);
  const ctx = { ...ctxFor(db, { type: "agent", id: A.id, name: A.name }), caller } as never;
  const out = await (H.access_list as HandlerSpec<any, any>).run(input as never, ctx);
  const vout = validateAgainstSchema(view.output as never, out as never);
  assert.ok(vout.ok, `output invalid: ${JSON.stringify(vout.ok ? null : vout.errors)}`);
  return out;
}

function seed() {
  const db = migratedDb();
  upsertAgent(db, { id: A.id, name: A.name, mode: "free" });
  upsertAgent(db, { id: B.id, name: B.name, mode: "free" });
  insertProject(db, { id: A.id, name: "Agent A work", shared: false, ownerAgent: A.id }, OWNER);
  insertProject(db, { id: B.id, name: "Agent B work", shared: false, ownerAgent: B.id }, OWNER);
  insertProject(db, { id: "prj_shared", name: "Launch", shared: true, ownerAgent: null }, OWNER);
  return db;
}
const issue = (db: ReturnType<typeof migratedDb>, title: string, assignee: string | null, status: "backlog" | "todo" | "in_progress" | "done" = "todo") =>
  createIssue(db, { project: "prj_shared", title, status, assignee: assignee ? { kind: "agent", id: assignee } : null }, OWNER);

test("manifest: access_list is the LAST operation, audience agent, listing workflow, a read; no new manifest field", () => {
  const v = validateManifest(manifest);
  assert.equal(v.ok, true, v.ok ? "" : JSON.stringify(v.errors));
  const ops = manifest.operations;
  const last = ops[ops.length - 1] as unknown as Record<string, unknown>;
  assert.equal(last.id, "access_list");
  assert.equal(last.audience, "agent");
  assert.equal(last.listing, "workflow");
  assert.deepEqual(last.crud, ["read"]);
  assert.equal(last.effect, "read");
  assert.equal(last.idempotency, "none");
  assert.equal(last.receipt, false);
  assert.equal(ops.some((o) => o.id === "access_revoke"), false, "Task Board is a list-only target");
  assert.deepEqual(Object.keys(handlers).filter((id) => id.startsWith("access_")), ["access_list"]);
});

test("guard fire: every caller but a listed, verified `fleet` app is refused, with the exact code and status", async () => {
  const db = seed();
  const input = { v: 1, subjects: [{ kind: "all" }] };
  const cases: [string, Caller, string][] = [
    ["person", { type: "person", id: OWNER.id, name: "Owner" }, "no_access"],
    ["agent", { type: "agent", id: A.id, name: A.name }, "no_access"],
    ["app of another product", { ...fleet, product: "connect" }, "no_access"],
    ["app named like Governance but another product", { ...fleet, name: "fleet", product: "rules" }, "no_access"],
    ["app with no verified product", { type: "app", id: fleet.id, name: "Governance", listed: true }, "caller_unverified"],
    ["app with an empty product", { ...fleet, product: "" }, "caller_unverified"],
    ["app with no `listed` flag (older SDK)", { type: "app", id: fleet.id, name: "Governance", product: "fleet" }, "caller_unverified"],
    ["fleet no longer listed", { ...fleet, listed: false }, "caller_unverified"],
  ];
  for (const [label, caller, code] of cases) {
    await assert.rejects(
      () => list(db, input, caller),
      (e: { code?: string; httpStatus?: number }) => e.code === code && e.httpStatus === 403,
      label,
    );
  }
});

test("guard quiet: a listed fleet app is served", async () => {
  const out = await list(seed(), { v: 1, subjects: [{ kind: "all" }] });
  assert.equal(out.v, 1);
});

test("list: open assignments and own projects for an agent subject; done work and other agents are left out; labels are fixed words", async () => {
  const db = seed();
  const open = issue(db, "Secret launch plan", A.id, "in_progress");
  const parked = issue(db, "Maybe later", A.id, "backlog");
  issue(db, "Finished", A.id, "done");
  issue(db, "Not A's", B.id);
  issue(db, "Nobody's", null);
  const out = await list(db, { v: 1, subjects: [{ kind: "agent", id: A.id }], sweepId: "sw_1" });
  assert.equal(out.sweepId, "sw_1");
  assert.deepEqual(out.items.map((i: { id: string }) => i.id).sort(), [`assignment:${open.id}`, `assignment:${parked.id}`, `own_project:${A.id}`].sort());
  const byId = Object.fromEntries(out.items.map((i: { id: string }) => [i.id, i]));
  assert.equal(byId[`assignment:${open.id}`].state, "active");
  assert.equal(byId[`assignment:${parked.id}`].state, "dormant");
  assert.equal(byId[`own_project:${A.id}`].resource, A.id);
  for (const i of out.items) {
    assert.deepEqual(i.subject, { kind: "agent", id: A.id });
    assert.equal(i.level, "info");
    assert.equal(i.direction, "held_by");
    assert.equal(i.revocable, false);
    assert.match(i.digest, /^sha256:[0-9a-f]{64}$/u);
  }
  const text = JSON.stringify(out);
  for (const secret of ["Secret launch plan", "Maybe later", "Agent A work"]) assert.equal(text.includes(secret), false, `no content leaves: ${secret}`);
});

test("list: notShown names what this version cannot list, so complete is false and nothing reads as 'no access'", async () => {
  const out = await list(seed(), { v: 1, subjects: [{ kind: "agent", id: A.id }] });
  assert.deepEqual(out.notShown.map((n: { kind: string }) => n.kind), ["project_access", "held_calls"]);
  assert.equal(out.nextCursor, null);
  assert.equal(out.complete, false);
});

test("list: person and unlinked subjects give no items (Task Board ties nothing to a Governance person)", async () => {
  const db = seed();
  issue(db, "x", A.id);
  const out = await list(db, { v: 1, subjects: [{ kind: "person", id: "per_x", handles: ["slack:U012ABCDEF"] }, { kind: "unlinked" }] });
  assert.deepEqual(out.items, []);
});

test("sweep: `all` pages by cursor in id order, no repeats, no gaps, and the last page has nextCursor null", async () => {
  const db = seed();
  const ids: string[] = [];
  for (let n = 0; n < 7; n++) ids.push(`assignment:${issue(db, `t${n}`, n % 2 ? A.id : B.id).id}`);
  const want = [...ids, `own_project:${A.id}`, `own_project:${B.id}`].sort();
  const got: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const out = await list(db, { v: 1, subjects: [{ kind: "all" }], limit: 2, ...(cursor ? { cursor } : {}) });
    assert.ok(out.items.length <= 2);
    got.push(...out.items.map((i: { id: string }) => i.id));
    cursor = out.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 20);
  assert.deepEqual(got, want);
  assert.equal(pages, 5);
});

test("digest: the same item active then paused keeps its digest; another subject or resource changes it", async () => {
  const db = seed();
  const i = issue(db, "x", A.id, "backlog");
  const first = (await list(db, { v: 1, subjects: [{ kind: "agent", id: A.id }] })).items.find((r: { id: string }) => r.id === `assignment:${i.id}`);
  db.prepare("UPDATE issues SET status = 'in_progress' WHERE id = ?").run(i.id);
  const second = (await list(db, { v: 1, subjects: [{ kind: "agent", id: A.id }] })).items.find((r: { id: string }) => r.id === `assignment:${i.id}`);
  assert.equal(first.state, "dormant");
  assert.equal(second.state, "active");
  assert.equal(first.digest, second.digest);
  assert.equal(TARGET, manifest.id);
  const base = { id: first.id, kind: "assignment" as const, subject: first.subject, resource: first.resource, level: "info" as const };
  assert.equal(digestOf(base), first.digest);
  assert.notEqual(digestOf({ ...base, subject: { kind: "agent", id: B.id } }), first.digest);
  assert.notEqual(digestOf({ ...base, resource: "iss_other" }), first.digest);
});

test("invalid calls: `all` must be alone, limit and cursor are checked, with the exact code and status 400", async () => {
  const db = seed();
  const bad: [unknown, string][] = [
    [{ v: 1, subjects: [{ kind: "all" }, { kind: "agent", id: A.id }] }, "invalid_subjects"],
    [{ v: 1, subjects: [{ kind: "agent", id: "not-an-agent" }] }, "invalid_subjects"],
    [{ v: 1, subjects: [{ kind: "all" }], cursor: "AAAA" }, "bad_cursor"],
    [{ v: 1, subjects: [{ kind: "all" }], cursor: Buffer.from("issue:iss_1").toString("base64url") }, "bad_cursor"],
  ];
  for (const [input, code] of bad)
    await assert.rejects(
      () => list(db, input, fleet, { skipSchema: true }),
      (e: { code?: string; httpStatus?: number }) => e.code === code && e.httpStatus === 400,
      code,
    );
  // the schema refuses the rest before any handler runs
  const view = manifest.operations.find((o) => o.id === "access_list");
  for (const input of [
    { v: 1, subjects: [] },
    { v: 1, subjects: [{ kind: "all" }], limit: 0 },
    { v: 1, subjects: [{ kind: "all" }], limit: 201 },
    { v: 2, subjects: [{ kind: "all" }] },
    { v: 1, subjects: [{ kind: "all" }, { kind: "agent", id: A.id }] },
    { v: 1, subjects: [{ kind: "agent", id: "not-an-agent" }] },
  ])
    assert.equal(validateAgainstSchema(view?.input as never, input as never).ok, false, JSON.stringify(input));
});

test("the op writes nothing: no app row for the caller, no project, no activity", async () => {
  const db = seed();
  const count = () => ["apps", "projects", "agents", "issues", "activity"].map((t) => Number(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n));
  const before = count();
  await list(db, { v: 1, subjects: [{ kind: "all" }] });
  assert.deepEqual(count(), before);
});

test("conformance strip: the suite's manifest is the shipped one minus the guarded ops; the shipped manifest is untouched", () => {
  assert.deepEqual([...GUARDED_OPS], ["access_list"]);
  const served = conformanceManifest(manifest);
  assert.deepEqual(
    served.operations.map((o) => o.id),
    manifest.operations.filter((o) => o.id !== "access_list").map((o) => o.id),
  );
  assert.equal(served.operations.some((o) => o.id === "access_list"), false);
  assert.ok(manifest.operations.some((o) => o.id === "access_list"));
  assert.equal(validateManifest(served).ok, true);
});
