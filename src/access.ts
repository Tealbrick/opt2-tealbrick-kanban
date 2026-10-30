// C380 `tb.access/1` (docs/ACCESS.md in specs): the one read op Governance (product id `fleet`) calls to see what each agent
// holds on the Task Board. Task Board lists two kinds, both information only:
//   assignment  an open issue assigned to the agent   (resource = issue id)
//   own_project the agent's own project                (resource = project id)
// Nothing here changes data and Task Board has no `access_revoke` op: project access is the SDK `shared` default grant plus the
// scope instance (`share_grants` was dropped in 0.1.3), so it is NOT listed and `notShown` says so. Nothing is hidden by a
// silent zero: `complete` is false while `notShown` has rows.
// Labels are fixed words. No issue title, project name, summary or comment ever leaves in an item (C88).

import { createHash } from "node:crypto";
import { canonicalize } from "@opt2-tealbrick/manifest";
import type { Db, OpContext } from "@opt2-tealbrick/miniapp-sdk";
import { TbError } from "@opt2-tealbrick/miniapp-sdk";

/** The product id in every digest (the verified product of this app, `kanban`). */
export const TARGET = "kanban";
/** The only app that may call the access ops: the verified product of the caller, never its name. */
export const GOVERNANCE_PRODUCT = "fleet";

export const MAX_SUBJECTS = 32;
export const MAX_HANDLES = 16;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 200;

type Row = Record<string, unknown>;

export type Subject =
  | { kind: "agent"; id: string }
  | { kind: "person"; id: string; handles: string[] }
  | { kind: "unlinked" }
  | { kind: "all" };

export interface ListIn {
  v: 1;
  subjects: Subject[];
  cursor?: string;
  limit?: number;
  sweepId?: string;
}

export interface AccessItem {
  id: string;
  kind: "assignment" | "own_project";
  subject: { kind: "agent"; id: string };
  resource: string;
  direction: "held_by";
  level: "info";
  label: string;
  state: "active" | "dormant";
  revocable: false;
  since?: string;
  digest: string;
}

export interface ListOut {
  v: 1;
  asOf: string;
  sweepId?: string;
  items: AccessItem[];
  nextCursor: string | null;
  notShown: { kind: string; reason: string }[];
  complete: boolean;
}

/** Kinds this version cannot list, in plain words (the reason is shown to the owner). */
export const NOT_SHOWN: readonly { kind: string; reason: string }[] = [
  { kind: "project_access", reason: "Which projects an agent may read or change is set by the Portal grant and the shared default, not by Task Board." },
  { kind: "held_calls", reason: "Calls waiting for an owner decision are kept by the Portal, not by Task Board." },
];

/**
 * Who may call the access ops. Fail closed. The same six caller cases are in the spec fixture (caller vector).
 *   person, agent               -> no_access          (only an app may ask)
 *   app, product is not `fleet` -> no_access          (a name is not an identity: only the VERIFIED product counts)
 *   app, no verified product    -> caller_unverified
 *   app, `listed` missing       -> caller_unverified  (older SDK or no signed slice: unknown fails closed)
 *   app, `listed` false         -> caller_unverified  (the companion edge was removed or the slice expired)
 *   app, fleet, listed true     -> allowed
 */
export function guardCaller(ctx: Pick<OpContext, "caller">): void {
  const c = ctx.caller as { type?: unknown; product?: unknown; listed?: unknown };
  if (c.type !== "app") throw new TbError("no_access", "Only the Governance app may call this operation.", 403);
  if (typeof c.product !== "string" || c.product === "") throw new TbError("caller_unverified", "The calling app has no verified product.", 403);
  if (c.product !== GOVERNANCE_PRODUCT) throw new TbError("no_access", "Only the Governance app may call this operation.", 403);
  if (typeof c.listed !== "boolean") throw new TbError("caller_unverified", "The calling app is not confirmed by the signed workspace slice.", 403);
  if (!c.listed) throw new TbError("caller_unverified", "The calling app is no longer listed in this workspace.", 403);
}

const bad = (code: string, message: string) => new TbError(code, message, 400);

const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{26}$/u;

/** A page cursor is the id of the last item sent (opaque to the caller). */
const encodeCursor = (id: string) => Buffer.from(id, "utf8").toString("base64url");
function decodeCursor(c: string | undefined): string | null {
  if (c === undefined) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(c)) throw bad("bad_cursor", "The cursor is not one this app gave.");
  const id = Buffer.from(c, "base64url").toString("utf8");
  if (!/^(assignment|own_project):[A-Za-z0-9_-]{1,100}$/u.test(id)) throw bad("bad_cursor", "The cursor is not one this app gave.");
  return id;
}

/** Item digest: sha256 of the JCS of {v, target, id, kind, subject, resource, level}. NOT state, since, label, revocable, direction. */
export function digestOf(item: Pick<AccessItem, "id" | "kind" | "subject" | "resource" | "level">, target: string = TARGET): string {
  const body = { v: 1, target, id: item.id, kind: item.kind, subject: item.subject, resource: item.resource, level: item.level };
  return `sha256:${createHash("sha256").update(canonicalize(body as never)).digest("hex")}`;
}

/** The agent ids the call asks about, or null for a sweep (`all`). Refuses a malformed list. */
export function agentFilter(subjects: readonly Subject[]): Set<string> | null {
  if (!Array.isArray(subjects) || subjects.length < 1 || subjects.length > MAX_SUBJECTS) throw bad("invalid_subjects", `subjects needs 1 to ${MAX_SUBJECTS} entries.`);
  if (subjects.some((s) => s.kind === "all")) {
    if (subjects.length !== 1) throw bad("invalid_subjects", "The subject `all` must be the only subject.");
    return null;
  }
  const ids = new Set<string>();
  for (const s of subjects) {
    if (s.kind === "agent") {
      if (!AGENT_ID.test(s.id)) throw bad("invalid_subjects", "An agent subject needs an agent id.");
      ids.add(s.id);
    } else if (s.kind === "person") {
      if (typeof s.id !== "string" || s.id === "" || s.id.length > 64) throw bad("invalid_subjects", "A person subject needs an id.");
      if (!Array.isArray(s.handles) || s.handles.length > MAX_HANDLES) throw bad("invalid_subjects", `A person subject has at most ${MAX_HANDLES} handles.`);
    }
    // `person` and `unlinked`: Task Board ties nothing to a Governance person, so they add no agent
  }
  return ids;
}

const iso = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

function assignmentItem(r: Row): AccessItem {
  const subject = { kind: "agent" as const, id: String(r.assignee_id) };
  const partial = { id: `assignment:${String(r.id)}`, kind: "assignment" as const, subject, resource: String(r.id), level: "info" as const };
  const status = String(r.status);
  return {
    ...partial,
    direction: "held_by",
    label: `Assigned issue, ${status.replaceAll("_", " ")}`,
    state: status === "backlog" ? "dormant" : "active",
    revocable: false,
    ...(iso(r.created_at) ? { since: iso(r.created_at) } : {}),
    digest: digestOf(partial),
  };
}

function projectItem(r: Row): AccessItem {
  const subject = { kind: "agent" as const, id: String(r.owner_agent) };
  const partial = { id: `own_project:${String(r.id)}`, kind: "own_project" as const, subject, resource: String(r.id), level: "info" as const };
  return {
    ...partial,
    direction: "held_by",
    label: "Own project",
    state: "active",
    revocable: false,
    ...(iso(r.created_at) ? { since: iso(r.created_at) } : {}),
    digest: digestOf(partial),
  };
}

/**
 * One page, in item-id order. `agents` null = sweep (every agent). The page reads at most `limit + 1` rows per kind, so a sweep
 * costs one bounded primary-key seek per kind per page. A subject the app cannot place (a person, `unlinked`) yields nothing.
 */
export function listAccess(db: Db, input: ListIn, now = Date.now()): ListOut {
  const agents = agentFilter(input.subjects);
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw bad("invalid_limit", `limit is 1 to ${MAX_LIMIT}.`);
  if (input.sweepId !== undefined && (typeof input.sweepId !== "string" || input.sweepId.length < 1 || input.sweepId.length > 64)) throw bad("invalid_sweep", "sweepId is 1 to 64 characters.");
  const after = decodeCursor(input.cursor);
  const ids = agents === null ? null : [...agents];
  const out: AccessItem[] = [];
  if (ids === null || ids.length > 0) {
    // Item ids sort `assignment:` before `own_project:`, so a cursor of kind K lets each query seek on its own primary key:
    // assignments after an `own_project:` cursor are all behind it, projects before an `assignment:` cursor are all ahead.
    const cut = after === null ? null : { kind: after.slice(0, after.indexOf(":")), id: after.slice(after.indexOf(":") + 1) };
    const marks = (col: string) => (ids === null ? "" : ` AND ${col} IN (${ids.map(() => "?").join(",")})`);
    const args = ids ?? [];
    // `own_project` is an AGENT's project: an app's own project (owner_agent = its instance id) is not an agent item
    if (cut?.kind !== "own_project") {
      const rows = db
        .prepare(`SELECT id, assignee_id, status, created_at FROM issues WHERE assignee_kind = 'agent' AND status <> 'done' AND id > ?${marks("assignee_id")} ORDER BY id LIMIT ?`)
        .all(cut?.kind === "assignment" ? cut.id : "", ...args, limit + 1);
      for (const r of rows) if (AGENT_ID.test(String(r.assignee_id))) out.push(assignmentItem(r as Row));
    }
    const projects = db
      .prepare(`SELECT id, owner_agent, created_at FROM projects WHERE owner_agent LIKE 'agt\\_%' ESCAPE '\\' AND length(owner_agent) = 30 AND id > ?${marks("owner_agent")} ORDER BY id LIMIT ?`)
      .all(cut?.kind === "own_project" ? cut.id : "", ...args, limit + 1);
    for (const r of projects) if (AGENT_ID.test(String(r.owner_agent))) out.push(projectItem(r as Row));
    out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }
  const page = out.slice(0, limit);
  const more = out.length > limit;
  const last = page.at(-1);
  return {
    v: 1,
    asOf: new Date(now).toISOString(),
    ...(input.sweepId !== undefined ? { sweepId: input.sweepId } : {}),
    items: page,
    nextCursor: more && last ? encodeCursor(last.id) : null,
    notShown: NOT_SHOWN.map((n) => ({ ...n })),
    // by contract: nextCursor === null && notShown is empty, nothing else
    complete: !more && NOT_SHOWN.length === 0,
  };
}
