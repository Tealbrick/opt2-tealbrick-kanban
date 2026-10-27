// Agents & scopes: the access grid, one Select per agent and project. It is the `render` of the shared AgentsPage, so
// the heading, loading, load error and empty state come from ./standard.tsx.
// C283d (SDK >= 0.1.36): when an app update widened a level, the owner row keeps its old rights and carries `offer.adds`.
// The grid shows what the update would add and accepts it ONLY on the owner's click on "Allow" (never on load, never silently).

import type { CrudAction } from "@opt2-tealbrick/manifest";
import { useScopes } from "@opt2-tealbrick/miniapp-sdk/client";
import { Button, EmptyState, Field, Notice, Select, Swatch, Tag } from "@opt2-tealbrick/ui";
import { useCallback, useEffect, useState } from "react";
import { explain, type Project, run } from "./api.ts";
import type { Agent } from "./standard.tsx";

/** Plain words for the CRUD actions an offer adds. */
const ACTION_WORDS: Record<string, string> = { read: "read", create: "add", update: "change", delete: "delete" };
export const offerText = (adds: readonly string[]) => `This update lets the agent also ${adds.map((a) => ACTION_WORDS[a] ?? a).join(", ")} here.`;

const ACCESS = [
  { value: "", label: "No access" },
  { value: "read", label: "Read" },
  { value: "contribute", label: "Read and work" },
  { value: "manage", label: "Read, work and delete" },
];

export function ScopeGrid({ agents }: { agents: readonly Agent[] }) {
  const { access, set, acceptOffer } = useScopes();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoadError(null);
    run("board_view", {})
      .then((d) => setProjects(d.projects))
      .catch((e: unknown) => setLoadError(explain(e)));
  }, []);
  useEffect(load, [load]);
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
  if (!projects) {
    return (
      <p className="tb-soft" role="status">
        Loading projects.
      </p>
    );
  }
  if (!projects.length) return <EmptyState title="No projects yet">Create a project on the Board, then choose here which agents can use it.</EmptyState>;
  const row = (agent: string, project: string) => access.find((r) => r.agent === agent && r.type === "project" && r.instanceId === project);
  const level = (agent: string, project: string) => row(agent, project)?.access ?? "";
  const allow = async (agent: string, project: string, adds: CrudAction[]) => {
    setBusy(`${agent}|${project}`);
    setError(null);
    try {
      await acceptOffer(agent as never, "project", project, adds);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };
  const change = async (agent: string, project: string, value: string) => {
    setBusy(`${agent}|${project}`);
    setError(null);
    try {
      await set(agent as never, "project", project, value || null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {error ? (
        <Notice tone="needs-you" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="ruled">
        {agents.map((a) => (
          <section className="kb-agent" key={a.id} aria-label={a.name}>
            <div className="tb-row kb-who-row">
              <Swatch />
              <h3>{a.name}</h3>
              {a.mode ? <Tag>{`${a.mode.charAt(0).toUpperCase()}${a.mode.slice(1)}`}</Tag> : null}
              {a.status === "paused" ? <Tag status="needs-you">paused</Tag> : null}
            </div>
            <div className="kb-grants">
              {projects.map((p) => {
                const adds = row(a.id, p.id)?.offer?.adds ?? [];
                return (
                  <Field key={p.id} label={p.name}>
                    <Select
                      aria-label={`${a.name} access to ${p.name}`}
                      options={ACCESS}
                      value={level(a.id, p.id)}
                      disabled={busy === `${a.id}|${p.id}`}
                      onValueChange={(v) => void change(a.id, p.id, v)}
                    />
                    {adds.length ? (
                      <Notice tone="needs-you">
                        <span className="tb-row">
                          <span>{offerText(adds)}</span>
                          <Button size="sm" disabled={busy === `${a.id}|${p.id}`} onClick={() => void allow(a.id, p.id, adds)} aria-label={`Allow ${a.name} the new rights in ${p.name}`}>
                            Allow
                          </Button>
                        </span>
                      </Notice>
                    ) : null}
                  </Field>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
