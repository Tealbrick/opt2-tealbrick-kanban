// App events (C274 S4; MANIFEST §16, SDK-API §20): Task Board wakes the agents an issue change is for.
//
// The board store (board.ts) reports WHAT happened as plain `BoardEvent`s to an optional sink, inside the same database
// transaction as the change; it knows nothing about the SDK. `eventSink(ctx, actor)` turns them into `ctx.emit` calls, so
// the outbox row commits or rolls back with the change (SDK-API §20). Owner (person) ops and agent/app ops share the store
// functions, so both emit the same way.
//
// Rules (DONE-DEFINITION §1.1):
//   - recipients (`to`) are agents only; the owner and app callers never are, and neither is the agent that caused the change
//     (the SDK also sets `causedBy`, the bridge drops it there); duplicates collapse; no recipient = no emit
//   - every event is scoped on the issue's project (`visibleWith: issue_get`, scope type project): instanceId = project id,
//     so the SDK's `eligible` and the bridge deliver only to agents whose row on that project admits `read`
//   - data = ids and enums only (manifest payloadSchema); summary = what issue_get shows that agent, ≤ 280 chars, and always
//     `untrusted: true` (titles and comments are written by agents and people, never instructions)
import type { OpContext } from "@opt2-tealbrick/miniapp-sdk";
import type { Actor, Status } from "./board.ts";

/** Event names as the manifest declares them (wire type = `kanban.<name>`). */
export const EVENT = {
  assigned: "issue.assigned",
  unblocked: "issue.unblocked",
  commented: "issue.commented",
} as const;

/** A board party that might be told: an assignee or creator as stored ({kind, id}); only agents ever receive events. */
export interface Party {
  kind: string;
  id: string;
}
export type UnblockCause = "dependency_done" | "dependency_removed" | "status_change";

export type BoardEvent =
  | { type: "assigned"; issue: string; project: string; title: string; status: Status; reason: "created" | "reassigned"; to: Party }
  | { type: "unblocked"; issue: string; project: string; title: string; status: Status; cause: UnblockCause; unblockedBy?: string; to: Party }
  | { type: "commented"; issue: string; project: string; commentId: string; body: string; to: readonly Party[] };

/** Receives board events inside the change's transaction (board.ts calls it right after the write). */
export type EventSink = (e: BoardEvent) => void;

/** SDK-API §20: `to` entries are agent ids (`agt_` + ULID); anything else cannot receive events. */
const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{26}$/;
export const SUMMARY_MAX = 280;

/** The agents of `parties`, minus the actor that caused the change, deduplicated, in order. */
export function recipients(parties: readonly Party[], actor: Actor): string[] {
  const out: string[] = [];
  for (const p of parties) {
    if (p.kind !== "agent" || !AGENT_ID.test(p.id)) continue;
    if (actor.kind === "agent" && p.id === actor.id) continue;
    if (!out.includes(p.id)) out.push(p.id);
  }
  return out;
}

/** One line, at most SUMMARY_MAX characters (an ellipsis marks a cut). */
export function summaryOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= SUMMARY_MAX ? flat : `${flat.slice(0, SUMMARY_MAX - 1)}…`;
}

/** The `ctx.emit` arguments of one board event, or null when nobody is to be told. */
export function toEmit(e: BoardEvent, actor: Actor): { name: string; data: Record<string, unknown>; to: string[]; summary: string } | null {
  const by = { kind: actor.kind, id: actor.id };
  switch (e.type) {
    case "assigned": {
      const to = recipients([e.to], actor);
      return to.length ? { name: EVENT.assigned, data: { projectId: e.project, status: e.status, reason: e.reason, by }, to, summary: summaryOf(e.title) } : null;
    }
    case "unblocked": {
      const to = recipients([e.to], actor);
      const data = { projectId: e.project, status: e.status, cause: e.cause, ...(e.unblockedBy ? { unblockedBy: e.unblockedBy } : {}) };
      return to.length ? { name: EVENT.unblocked, data, to, summary: summaryOf(e.title) } : null;
    }
    case "commented": {
      const to = recipients(e.to, actor);
      return to.length ? { name: EVENT.commented, data: { projectId: e.project, commentId: e.commentId, by }, to, summary: summaryOf(`${actor.name}: ${e.body}`) } : null;
    }
  }
}

/** The sink of one op call: board events → `ctx.emit` in the open transaction. Undefined on a context without events
 *  (hand-built test contexts; the SDK sets `emit` from 0.1.38). */
export function eventSink(ctx: Pick<OpContext, "emit">, actor: Actor): EventSink | undefined {
  const emit = ctx.emit;
  if (!emit) return undefined;
  return (e) => {
    const m = toEmit(e, actor);
    if (!m) return;
    emit(m.name, m.data as never, { subject: { kind: "issue", id: e.issue }, to: m.to as never, instanceId: e.project, summary: m.summary, untrusted: true });
  };
}
