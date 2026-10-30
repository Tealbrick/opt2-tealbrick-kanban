// C380 B6 real path: the REAL Task Board on the REAL Miniapp SDK (claim, slice, companion grants, op proofs, input and output
// schemas) behind the conformance fake bridge, serving the FULL manifest (production's, with access_list). This is the proof
// the conformance suite cannot give for a guarded op: the SDK pipeline in front of the guard, and the answer through the schema.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type AppClient, appEnv, createFakeBridge, type FakeBridge, TEST_ROOTS_ENV } from "@opt2-tealbrick/conformance";
import { defineApp, startApp } from "@opt2-tealbrick/miniapp-sdk";
import { definition, manifest } from "../src/app.ts";

type InstanceId = `ins_${string}`;
const FLEET = "ins_01M5PM73ZZ0F1EET0000000000" as InstanceId;
const OTHER = "ins_01M5PM73ZZ0APP000000000000" as InstanceId;

let bridge: FakeBridge;
let app: { stop(): Promise<void>; port: number };
let client: AppClient;
let dataDir: string;
let key = 0;
const idem = () => `c380-kb-${String(++key).padStart(4, "0")}`;

before(async () => {
  bridge = await createFakeBridge({ manifest });
  await bridge.control.publishKeySet();
  dataDir = mkdtempSync(join(tmpdir(), "kanban-c380-"));
  const env = appEnv(bridge, dataDir, { [TEST_ROOTS_ENV]: JSON.stringify(bridge.testRootJwks()), TBCONF_PORT: "0" });
  app = (await startApp(defineApp(definition), env, { portalRootKeys: JSON.parse(env[TEST_ROOTS_ENV] as string), port: 0 } as never)) as never;
  await bridge.control.waitForClaim(30_000);
  await bridge.control.waitForSliceRevision(1, 30_000);
  await bridge.control.listCompanionCaller({ product: "fleet", ins: FLEET, name: "Governance", provider: "railway" });
  await bridge.control.listCompanionCaller({ product: "connect", ins: OTHER, name: "Connect", provider: "railway" });
  client = bridge.client(`http://127.0.0.1:${app.port}`);
});

after(async () => {
  await app?.stop();
  await bridge?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const asFleet = (op: string, input: object, extra: object = {}) => client.callOp(op, input as never, { caller: FLEET, prd: "fleet", wf: [op], crud: ["read"] as never, ...extra });
const body = (a: { body: unknown }) => (a.body as { output?: Record<string, any> } | null)?.output ?? {};

test("real path: Governance lists an agent's own project and assigned issue; the SDK validates the answer; the op writes no board row", async () => {
  const [agentA] = bridge.ids.agents.filter((x) => x.mode === "free").map((x) => x.id);
  assert.ok(agentA);
  const made = await client.callOp("issue_create", { title: "Quarterly report", assignee: "me" } as never, { agent: agentA as never, idempotencyKey: idem() });
  assert.equal(made.status, 200, made.code ?? undefined);
  const issueId = (body(made).issue as { id: string }).id;
  const before = await client.callOp("projects_list", {} as never, { agent: agentA as never });
  const out = await asFleet("access_list", { v: 1, subjects: [{ kind: "all" }], sweepId: "sw_real" });
  assert.equal(out.status, 200, `${out.code}`);
  const o = body(out);
  assert.equal(o.sweepId, "sw_real");
  assert.equal(o.complete, false);
  assert.deepEqual(o.notShown.map((n: { kind: string }) => n.kind), ["project_access", "held_calls"]);
  const ids = o.items.map((i: { id: string }) => i.id);
  assert.ok(ids.includes(`assignment:${issueId}`), "the assigned issue");
  assert.ok(ids.includes(`own_project:${agentA}`), "the agent's own project");
  assert.equal(JSON.stringify(o).includes("Quarterly report"), false, "no title leaves");
  const after = await client.callOp("projects_list", {} as never, { agent: agentA as never });
  assert.deepEqual(body(after), body(before), "the board is unchanged by the read");
});

test("real path: an app that is not Governance, and an agent, are refused; an app's own project never breaks the sweep", async () => {
  const [agentA] = bridge.ids.agents.filter((x) => x.mode === "free").map((x) => x.id);
  // another companion app: its first board call makes its own project (owner_agent is its instance id), then it asks for the list
  const projects = await client.callOp("projects_list", {} as never, { caller: OTHER, prd: "connect", wf: ["projects_list"], crud: ["read"] as never });
  assert.equal(projects.status, 200, projects.code ?? undefined);
  const refused = await client.callOp("access_list", { v: 1, subjects: [{ kind: "all" }] } as never, { caller: OTHER, prd: "connect", wf: ["access_list"], crud: ["read"] as never });
  assert.equal(refused.status, 403);
  assert.equal(refused.code, "no_access");
  const agent = await client.callOp("access_list", { v: 1, subjects: [{ kind: "all" }] } as never, { agent: agentA as never });
  assert.equal(agent.status, 403, `${agent.code}`);
  const sweep = await asFleet("access_list", { v: 1, subjects: [{ kind: "all" }] });
  assert.equal(sweep.status, 200, `${sweep.code}`);
  assert.deepEqual(body(sweep).items.filter((i: { subject: { id: string } }) => !i.subject.id.startsWith("agt_")), []);
});

test("real path: a bad call is refused by the schema before the handler (all is not alone, limit out of range)", async () => {
  for (const input of [{ v: 1, subjects: [{ kind: "all" }, { kind: "unlinked" }] }, { v: 1, subjects: [{ kind: "all" }], limit: 500 }, { v: 2, subjects: [{ kind: "all" }] }]) {
    const a = await asFleet("access_list", input);
    assert.equal(a.status, 400, JSON.stringify(input));
  }
});
