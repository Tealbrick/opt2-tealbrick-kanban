// Agents & scopes: the kit's AccessEditor (C382): the defaults once, then only what differs, and a bulk editor. It is the
// `render` of the shared AgentsPage, so the heading, loading, load error and empty state come from ./standard.tsx.
// C283d (SDK >= 0.1.36): when an app update widened a level, the owner row keeps its old rights and carries `offer.adds`.
// The page shows what the update would add and accepts it ONLY on the owner's click on "Allow" (never on load, never silently).

import { callOp } from "@opt2-tealbrick/miniapp-sdk/client";
import { type AccessCell, type AccessChange, AccessEditor, Button, EmptyState, Notice } from "@opt2-tealbrick/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { explain, type Project, run } from "./api.ts";
import type { Agent } from "./standard.tsx";

/** Plain words for the CRUD actions an offer adds. */
const ACTION_WORDS: Record<string, string> = { read: "read", create: "add", update: "change", delete: "delete" };
export const offerText = (adds: readonly string[]) => `This update lets the agent also ${adds.map((a) => ACTION_WORDS[a] ?? a).join(", ")} here.`;

/** The levels of `scopes[].access` in tealbrick.manifest.json (test/ui-scopes.test.ts compares them). */
export const LEVELS = [
  { id: "read", label: "Read" },
  { id: "contribute", label: "Read and work" },
  { id: "manage", label: "Read, work and delete" },
];
/** `scopes[].defaultGrants` in the manifest: own → manage, shared → contribute. An own project keeps "own" when it is also shared. */
export const projectDefault = (agent: string, project: Pick<Project, "ownerAgent" | "shared"> | undefined): string | null => (project?.ownerAgent === agent ? "manage" : project?.shared ? "contribute" : null);

type Row = { type: string; instanceId: string; access: string; offer?: { adds: string[] } };
type AgentRows = Agent & { access?: Row[] };
const loadAgents = async () => (await callOp<{ agents: AgentRows[] }>("tb.agents_list", {})).agents;
const writeLevel = (change: AccessChange) => callOp("tb.scopes_set", { agent: change.agent, type: "project", id: change.scope, access: change.level });

function cellsOf(agents: readonly AgentRows[], nameOfProject: (id: string) => string): AccessCell[] {
  return agents.flatMap((agent) =>
    (agent.access ?? [])
      .filter((row) => row.type === "project")
      .map((row): AccessCell => {
        const adds = row.offer?.adds ?? [];
        return {
          agent: agent.id,
          scope: row.instanceId,
          level: row.access,
          ...(adds.length
            ? {
                action: {
                  text: offerText(adds),
                  label: "Allow",
                  ariaLabel: `Allow ${agent.name} the new rights in ${nameOfProject(row.instanceId)}`,
                  run: () => callOp("tb.scopes_set", { agent: agent.id, type: "project", id: row.instanceId, access: row.access, acceptOffer: { adds } }),
                },
              }
            : {}),
        };
      }),
  );
}

export function ScopeGrid() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [agents, setAgents] = useState<AgentRows[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([run("board_view", {}), loadAgents()])
      .then(([board, rows]) => {
        setProjects(board.projects);
        setAgents(rows);
      })
      .catch((e: unknown) => setLoadError(explain(e)));
  }, []);
  useEffect(load, [load]);
  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const cells = useMemo(() => cellsOf(agents ?? [], nameOf), [agents, nameOf]);
  const defaultOf = useCallback((agent: string, project: string) => projectDefault(agent, byId.get(project)), [byId]);
  const reload = useCallback(async () => {
    const rows = await loadAgents();
    setAgents(rows);
    return cellsOf(rows, nameOf);
  }, [nameOf]);
  const people = useMemo(
    () =>
      (agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        note: [a.mode ? `${a.mode.charAt(0).toUpperCase()}${a.mode.slice(1)}` : "", a.status === "paused" ? "paused" : ""].filter(Boolean).join(", "),
      })),
    [agents],
  );
  const scopes = useMemo(() => (projects ?? []).map((p) => ({ id: p.id, name: p.name })), [projects]);
  if (loadError) {
    return (
      <Notice tone="needs-you" role="alert">
        <span className="tb-row">
          <span>{loadError}</span>
          <Button size="sm" onClick={load}>
            Try again
          </Button>
        </span>
      </Notice>
    );
  }
  if (!projects || !agents) {
    return (
      <p className="tb-soft" role="status">
        Loading projects.
      </p>
    );
  }
  if (!projects.length) return <EmptyState title="No projects yet">Create a project on the Board, then choose here which agents can use it.</EmptyState>;
  return (
    <AccessEditor
      agents={people}
      scopes={scopes}
      levels={LEVELS}
      scopeWord={{ one: "project", many: "projects" }}
      defaults={[
        { what: "Its own project, for every agent", level: "manage" },
        { what: "A shared project, for every agent", level: "contribute" },
        { what: "Any other project", level: null },
      ]}
      cells={cells}
      defaultOf={defaultOf}
      write={writeLevel}
      reload={reload}
      explain={explain}
      storageKey="kanban-access"
    />
  );
}
