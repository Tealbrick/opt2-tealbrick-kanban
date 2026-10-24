// C331(6) task sync: issues imported from an outside tracker (Asana, Trello, Linear, Jira, ...) keep a reference, so a
// repeated import never makes a second card, and a "waiting to sync back" list tells agents which source cards to update.
// Task Board never calls the source (C88, C322(10)): an agent reads and writes it with its own Connect access and reports
// here; an app caller (Observer, later) uses the same import. Access checks live in the handlers.
//
// Status rule (KS-3): `synced_status` is the last status both sides agreed on. A changed source status is applied only
// while the card here still has that status; when someone moved the card here since, the board keeps its status and the
// item answers `conflict`.
import { type Db, TbError } from "@opt2-tealbrick/miniapp-sdk";
import { type Actor, createIssue, getIssue, type IssueView, invalid, issueRow, logActivity, notFound, type Priority, type Status, toIssue, updateIssue } from "./board.ts";

export interface ImportItem {
  externalId: string;
  title: string;
  summary?: string;
  status?: Status;
  priority?: Priority;
  url?: string;
  etag?: string;
}
export type ImportOutcome = "created" | "updated" | "unchanged" | "conflict";
export interface ImportResult {
  externalId: string;
  issue: string;
  outcome: ImportOutcome;
}

const SYSTEM = /^[a-z][a-z0-9_-]{1,31}$/;

/** System keys are lowercase (like template keys): refuse instead of changing the key, so refs stay stable. */
export function systemKey(v: string): string {
  if (!SYSTEM.test(v)) throw invalid("system_invalid", `system keys are lowercase (a-z, 0-9, _ and -, 2-32 chars, e.g. "trello"): got "${v.slice(0, 40)}"`);
  return v;
}
function checkUrl(v: string | undefined): string | null {
  if (v === undefined) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw invalid("url_invalid", "url must be an https link");
  }
  if (u.protocol !== "https:") throw invalid("url_invalid", "url must be an https link");
  return u.toString();
}

function refRow(db: Db, project: string, system: string, externalId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM issue_external WHERE project = ? AND system = ? AND external_id = ?").get(project, system, externalId);
}

/** One import call (≤ 50 items, checked by the schema): create new refs, update changed ones, skip unchanged ones. */
export function importIssues(db: Db, project: string, system: string, items: readonly ImportItem[], actor: Actor, now = Date.now()): ImportResult[] {
  const out: ImportResult[] = [];
  for (const it of items) {
    const title = it.title.trim();
    if (!title) throw invalid("title_empty", `title is empty (externalId ${it.externalId})`);
    const url = checkUrl(it.url);
    const ref = refRow(db, project, system, it.externalId);
    const current = ref ? issueRow(db, String(ref.issue)) : undefined;
    if (!ref || !current) {
      if (ref) db.prepare("DELETE FROM issue_external WHERE issue = ?").run(ref.issue);
      const status = it.status ?? "todo";
      const issue = createIssue(db, { project, title, summary: it.summary, status, priority: it.priority }, actor, now);
      db.prepare(
        `INSERT INTO issue_external (issue, project, system, external_id, url, etag, synced_status, synced_at, sync_error, imported_by_kind, imported_by_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(issue.id, project, system, it.externalId, url, it.etag ?? null, status, now, actor.kind, actor.id, now);
      logActivity(db, { project, issue: issue.id, actor, kind: "imported", summary: `Imported from ${system} (${it.externalId})` }, now);
      out.push({ externalId: it.externalId, issue: issue.id, outcome: "created" });
      continue;
    }
    const id = String(ref.issue);
    const synced = String(ref.synced_status);
    if (it.etag !== undefined && it.etag === ref.etag) {
      out.push({ externalId: it.externalId, issue: id, outcome: "unchanged" });
      continue;
    }
    let conflict = false;
    let nextSynced = synced;
    const patch: { title?: string; summary?: string; status?: Status; priority?: Priority } = { title };
    if (it.summary !== undefined) patch.summary = it.summary;
    if (it.priority !== undefined) patch.priority = it.priority;
    if (it.status !== undefined && it.status !== synced) {
      if (String(current.status) === synced) {
        patch.status = it.status;
        nextSynced = it.status;
      } else conflict = true;
    }
    const before = toIssue(db, current);
    const after = updateIssue(db, id, patch, actor, now).issue;
    const changed = after.updatedAt !== before.updatedAt || nextSynced !== synced || (it.etag !== undefined && it.etag !== ref.etag) || url !== (ref.url ?? null);
    db.prepare("UPDATE issue_external SET url = COALESCE(?, url), etag = COALESCE(?, etag), synced_status = ?, synced_at = ? WHERE issue = ?").run(url, it.etag ?? null, nextSynced, now, id);
    if (conflict) {
      logActivity(db, { project, issue: id, actor, kind: "sync_conflict", summary: `${system} says ${it.status}; the board keeps ${String(current.status)} (moved here since the last sync)` }, now);
      out.push({ externalId: it.externalId, issue: id, outcome: "conflict" });
    } else out.push({ externalId: it.externalId, issue: id, outcome: changed ? "updated" : "unchanged" });
  }
  return out;
}

/** KS-5: cards whose status here differs from the last agreed status; default only the ones done here. */
export function syncPending(db: Db, f: { projects: readonly string[]; system?: string; all?: boolean; limit: number }): IssueView[] {
  if (f.projects.length === 0) return [];
  const where = [`e.project IN (${f.projects.map(() => "?").join(", ")})`, "i.status <> e.synced_status"];
  const args: unknown[] = [...f.projects];
  if (f.system) {
    where.push("e.system = ?");
    args.push(f.system);
  }
  if (!f.all) where.push("i.status = 'done'");
  return db
    .prepare(`SELECT i.* FROM issue_external e JOIN issues i ON i.id = e.issue WHERE ${where.join(" AND ")} ORDER BY i.updated_at, i.id LIMIT ?`)
    .all(...args, f.limit)
    .map((r) => toIssue(db, r));
}

/** KS-6: the agent changed the source card; record the status the source has now (or why the push failed). */
export function ackSync(db: Db, issue: string, a: { status: Status; etag?: string; error?: string }, actor: Actor, now = Date.now()): IssueView {
  const ref = db.prepare("SELECT * FROM issue_external WHERE issue = ?").get(issue);
  if (!issueRow(db, issue)) throw notFound("issue");
  if (!ref) throw new TbError("not_external", "this issue was not imported from an outside tracker", 400);
  const project = String(ref.project);
  const error = a.error?.trim();
  if (error) {
    db.prepare("UPDATE issue_external SET sync_error = ?, synced_at = ? WHERE issue = ?").run(error.slice(0, 280), now, issue);
    logActivity(db, { project, issue, actor, kind: "sync_failed", summary: `Sync to ${String(ref.system)} failed: ${error.split("\n")[0]}` }, now);
  } else {
    db.prepare("UPDATE issue_external SET synced_status = ?, etag = COALESCE(?, etag), sync_error = NULL, synced_at = ? WHERE issue = ?").run(a.status, a.etag ?? null, now, issue);
    logActivity(db, { project, issue, actor, kind: "synced", summary: `${String(ref.system)} now says ${a.status}` }, now);
  }
  return getIssue(db, issue) as IssueView;
}

/** Per project: the number of cards waiting to sync back (board header count). */
export function pendingByProject(db: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.prepare("SELECT e.project, COUNT(*) AS n FROM issue_external e JOIN issues i ON i.id = e.issue WHERE i.status <> e.synced_status GROUP BY e.project").all())
    out[String(r.project)] = Number(r.n);
  return out;
}
