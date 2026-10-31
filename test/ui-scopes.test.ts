// Agents & scopes grid (src/ui/scopes.tsx) against the real SDK client and a stub server: C283d (SDK >= 0.1.36) — an owner
// row whose level an app update widened shows what the update adds, and the grid accepts it ONLY on the owner's click
// (tb.scopes_set with acceptOffer at the row's own level), never on load. Compiled with the build tsconfig into
// dist/ui-test-scopes and rendered in happy-dom.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "dist", "ui-test-scopes");

const win = new Window({ url: "http://localhost/a/kanban/", width: 1280, height: 860 });
const g = globalThis as Record<string, unknown>;
for (const k of ["window", "document", "navigator", "location", "history", "sessionStorage", "HTMLElement", "HTMLButtonElement", "HTMLDialogElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver"]) {
  const v = (win as unknown as Record<string, unknown>)[k];
  if (v === undefined) continue;
  try {
    g[k] = v;
  } catch {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
}
g.IS_REACT_ACT_ENVIRONMENT = true;

const AGENT = "agt_01J00000000000000000000AAA";
const calls: { op: string; input: Record<string, unknown> }[] = [];
let offer: { adds: string[] } | undefined = { adds: ["update", "delete"] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
  const path = url.pathname.replace("/a/kanban/tb/v1/", "");
  if (path === "session") return json(200, { principal: { type: "person", id: "per_1", instance: "ins_1" }, csrf: "csrf-token", idempotencyRequired: [] });
  const op = /^ops\/(.+)$/.exec(path)?.[1] ?? "";
  const body = JSON.parse(String(init?.body ?? "{}")) as { input?: Record<string, unknown> };
  calls.push({ op, input: body.input ?? {} });
  if (op === "board_view") return json(200, { status: "ok", output: { projects: [{ id: "prj_1", name: "Launch" }] } });
  if (op === "tb.agents_list")
    return json(200, {
      status: "ok",
      output: {
        agents: [
          {
            id: AGENT,
            name: "Henry",
            mode: "free",
            status: "active",
            access: [{ agent: AGENT, type: "project", instanceId: "prj_1", access: "read", authority: "owner", crud: ["read"], ...(offer ? { offer } : {}) }],
          },
        ],
      },
    });
  if (op === "tb.scopes_set") {
    offer = undefined;
    return json(200, { status: "ok", output: {} });
  }
  return json(404, { error: { code: "not_found", message: op } });
}) as typeof fetch;

const { act, createElement: h } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TbProvider } = await import("@opt2-tealbrick/miniapp-sdk/client");
let ScopeGrid: typeof import("../src/ui/scopes.tsx").ScopeGrid;
let scopesModule: typeof import("../src/ui/scopes.tsx");

before(async () => {
  const tsc = spawnSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", outDir], { cwd: root, encoding: "utf8" });
  assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
  scopesModule = (await import(pathToFileURL(join(outDir, "ui", "scopes.js")).href)) as typeof import("../src/ui/scopes.tsx");
  ({ ScopeGrid } = scopesModule);
});
after(() => rmSync(outDir, { recursive: true, force: true }));

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

it("C283d: an offer is shown with plain words and accepted only on the owner's click, at the row's own level", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  await act(async () => r.render(h(TbProvider, { product: "kanban" }, h(ScopeGrid))));
  await flush();
  assert.match(host.textContent ?? "", /This update lets the agent also change, delete here\./);
  assert.equal(calls.filter((c) => c.op === "tb.scopes_set").length, 0, "nothing is accepted on load");
  const allow = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Allow");
  assert.equal(allow?.getAttribute("aria-label"), "Allow Henry the new rights in Launch");
  assert.ok(allow, "an Allow button");
  await act(async () => (allow as HTMLElement).click());
  await flush();
  const set = calls.filter((c) => c.op === "tb.scopes_set");
  assert.deepEqual(
    set.map((c) => c.input),
    [{ agent: AGENT, type: "project", id: "prj_1", access: "read", acceptOffer: { adds: ["update", "delete"] } }],
  );
  assert.doesNotMatch(host.textContent ?? "", /This update lets/, "the offer is gone after the reload");
  await act(async () => r.unmount());
  host.remove();
});

it("C382: the levels and the default rule are those of the manifest", () => {
  const manifest = JSON.parse(readFileSync(join(root, "tealbrick.manifest.json"), "utf8")) as { scopes: { type: string; access: { id: string; label: string }[]; defaultGrants: { kind: string; access: string }[] }[] };
  const scope = manifest.scopes.find((s) => s.type === "project");
  assert.deepEqual(scopesModule.LEVELS, scope?.access.map((a) => ({ id: a.id, label: a.label })));
  const grant = (kind: string) => scope?.defaultGrants.find((g) => g.kind === kind)?.access;
  assert.equal(scopesModule.projectDefault("agt_a", { ownerAgent: "agt_a", shared: true }), grant("own"), "own wins over shared, the order the SDK grants them");
  assert.equal(scopesModule.projectDefault("agt_b", { ownerAgent: "agt_a", shared: true }), grant("shared"));
  assert.equal(scopesModule.projectDefault("agt_b", { ownerAgent: "agt_a", shared: false }), null);
});

it("C382: one dropdown row, not one per agent and project; an owner row equal to the default is not listed", async () => {
  offer = undefined;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  await act(async () => r.render(h(TbProvider, { product: "kanban" }, h(ScopeGrid))));
  await flush();
  assert.equal(host.querySelectorAll('[role="combobox"]').length, 3);
  assert.equal(host.querySelectorAll("[aria-label^='Back to default']").length, 1, "the read row differs from no access");
  await act(async () => r.unmount());
  host.remove();
});
