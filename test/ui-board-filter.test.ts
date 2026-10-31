// The project and assignee pickers of the board (src/ui/board.tsx, C382 batch 4): a filter on the choices. The lists
// load in full, so the filter reads all of them and says so; the chosen project and assignee stay in the list; a
// remembered filter shows after a remount. Compiled with the build tsconfig and rendered in happy-dom against a stub.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import type { ReactElement } from "react";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "dist", "ui-test-board-filter");

const win = new Window({ url: "http://localhost/a/kanban/", width: 1280, height: 860 });
const g = globalThis as Record<string, unknown>;
for (const k of ["window", "document", "navigator", "location", "history", "sessionStorage", "localStorage", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLDialogElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver"]) {
  const v = (win as unknown as Record<string, unknown>)[k];
  if (v === undefined) continue;
  try {
    g[k] = v;
  } catch {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
}
g.IS_REACT_ACT_ENVIRONMENT = true;

const pad = (n: number) => String(n).padStart(2, "0");
const projects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `prj_${pad(i)}`, name: `Project ${pad(i)}`, summary: "", shared: true, ownerAgent: null, team: false, counts: {}, createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z" }));
const agents = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `agt_${pad(i)}`, name: `Agent ${pad(i)}`, active: true }));
const stub = { projects: projects(12), agents: agents(12) };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
  const path = url.pathname.replace("/a/kanban/tb/v1/", "");
  if (path === "session") return json(200, { principal: { type: "person", id: "per_1", instance: "ins_1" }, csrf: "csrf-token", idempotencyRequired: [] });
  const op = /^ops\/(.+)$/.exec(path)?.[1];
  const body = JSON.parse(String(init?.body ?? "{}")) as { input?: Record<string, unknown> };
  if (op === "board_view") return json(200, { status: "ok", output: { projects: stub.projects, agents: stub.agents, project: body.input?.project ?? stub.projects[0]?.id ?? null, issues: [], goals: [], activity: [] } });
  return json(404, { error: { code: "not_found", message: String(op) } });
}) as typeof fetch;

const { act, createElement: h, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TbProvider } = await import("@opt2-tealbrick/miniapp-sdk/client");

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
async function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  await act(async () => r.render(h(TbProvider, { product: "kanban" }, el)));
  await flush();
  return {
    host,
    unmount: async () => {
      await act(async () => r.unmount());
      host.remove();
    },
  };
}
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
};
const text = (host: Element) => host.textContent ?? "";
const filters = (host: Element) => [...host.querySelectorAll(".tb-listfilter")];
/** The options of the picker whose field label is `label` (the listbox is in the DOM, hidden while closed). */
const optionsOf = (host: Element, label: string) => {
  const field = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(label));
  return [...(field?.querySelectorAll('[role="option"]') ?? [])].map((o) => (o.textContent ?? "").trim());
};
const KEY = "tb-filter:/a/kanban/:";

let Board: typeof import("../src/ui/board.tsx").Board;
before(async () => {
  const tsc = spawnSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", outDir], { cwd: root, encoding: "utf8" });
  assert.equal(tsc.status, 0, `${tsc.stdout}${tsc.stderr}`);
  ({ Board } = (await import(pathToFileURL(join(outDir, "ui", "board.js")).href)) as typeof import("../src/ui/board.tsx"));
});
after(() => rmSync(outDir, { recursive: true, force: true }));

function Page() {
  const [project, setProject] = useState<string | null>(null);
  return h(Board, { project, setProject });
}
const reset = (p = 12, a = 12) => {
  localStorage.clear();
  stub.projects = projects(p);
  stub.agents = agents(a);
};

describe("Board picker filters", () => {
  it("short lists show no filter", async () => {
    reset(3, 3);
    const m = await mount(h(Page));
    assert.equal(filters(m.host).length, 0);
    await m.unmount();
  });

  it("project picker: narrows, says N of M projects, keeps All projects and the chosen project, Clear restores", async () => {
    reset();
    const m = await mount(h(Page));
    assert.equal(filters(m.host).length, 2);
    assert.equal(optionsOf(m.host, "Project").length, 13);
    const input = filters(m.host)[0]?.querySelector("input") as HTMLInputElement;
    await type(input, "Project 07");
    assert.match(text(filters(m.host)[0] as Element), /Showing 1 of 12 projects\./);
    assert.deepEqual(optionsOf(m.host, "Project"), ["All projects", "Project 00", "Project 07"], "the chosen project stays");
    assert.equal(localStorage.getItem(`${KEY}board:project`), "Project 07");
    const clear = [...(filters(m.host)[0] as Element).querySelectorAll("button")].find((b) => b.textContent === "Clear filter");
    await click(clear as Element);
    assert.equal(optionsOf(m.host, "Project").length, 13);
    await m.unmount();
  });

  it("project picker: no match says all projects were searched", async () => {
    reset();
    const m = await mount(h(Page));
    await type(filters(m.host)[0]?.querySelector("input") as HTMLInputElement, "zzz");
    assert.match(text(filters(m.host)[0] as Element), /No project matches\. The filter searched all 12 projects\./);
    await m.unmount();
  });

  it("assignee picker: narrows by regex, keeps Everyone, Unassigned and Me, own key, remembered after a remount", async () => {
    reset();
    let m = await mount(h(Page));
    assert.equal(optionsOf(m.host, "Assignee filter").length, 15);
    await type(filters(m.host)[1]?.querySelector("input") as HTMLInputElement, "Agent 0[12]$");
    assert.match(text(filters(m.host)[1] as Element), /Showing 2 of 12 agents\./);
    assert.deepEqual(optionsOf(m.host, "Assignee filter"), ["Everyone", "Unassigned", "Me (owner)", "Agent 01", "Agent 02"]);
    assert.equal(localStorage.getItem(`${KEY}board:assignee`), "Agent 0[12]$");
    await m.unmount();
    m = await mount(h(Page));
    const again = filters(m.host)[1]?.querySelector("input") as HTMLInputElement;
    assert.equal(again.value, "Agent 0[12]$");
    assert.match(text(filters(m.host)[1] as Element), /Showing 2 of 12 agents\./);
    await m.unmount();
  });

  it("a remembered filter shows even when the list is short", async () => {
    reset(3, 3);
    localStorage.setItem(`${KEY}board:project`, "Project 01");
    const m = await mount(h(Page));
    assert.equal(filters(m.host).length, 1);
    assert.match(text(filters(m.host)[0] as Element), /Showing 1 of 3 projects\./);
    await m.unmount();
  });
});
