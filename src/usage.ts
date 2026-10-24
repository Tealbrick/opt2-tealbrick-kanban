// C331(7) token spend per task, as INFORMATION only (C327: "these are purely informational ... you need to have these
// limits directly in the harness"). The agent runtime (tealbrick agent serve) reports each finished turn's numbers; the
// model never writes them. Nothing in Task Board reads these numbers to decide anything: no budget, no warning, no hold.
//
// Attribution (KU-2), first rule that matches:
//   explicit  the report names an issue the caller can read (a routine job or wake event that names it)
//   activity  the issues the agent changed on the board during the turn, split evenly
//   in_progress  the agent's single in_progress issue
//   none      unattributed (kept per agent)
import { ulid } from "@opt2-tealbrick/manifest";
import type { Db } from "@opt2-tealbrick/miniapp-sdk";
import { invalid, issueRow } from "./board.ts";

export type UsageRule = "explicit" | "activity" | "in_progress" | "none";
export interface UsageReport {
  turn: string;
  startedAt: string;
  endedAt: string;
  harness: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd?: number;
  numTurns?: number;
}
export interface UsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** sum of the harness's own estimates (USD); null when no counted turn had one */
  costUsd: number | null;
}

/** Turns of the activity window: a little slack for clocks and for the activity row written just before the turn ended. */
const SLACK_MS = 5_000;
/** Unattributed turns are kept this long (KU-6). */
export const UNATTRIBUTED_KEEP_MS = 90 * 24 * 3600 * 1000;

function time(v: string, field: string): number {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw invalid(`${field}_invalid`, `${field} must be an RFC 3339 date-time`);
  return t;
}

/**
 * Records one turn for `agent` (the verified caller). `explicit` = an issue id the handler already checked the caller can
 * read; `projects` = the caller's readable projects (rules 2 and 3 count only issues there). A repeated (agent, turn)
 * is a duplicate: nothing is written and the first record's attribution is returned.
 */
export function recordUsage(
  db: Db,
  agent: string,
  r: UsageReport,
  o: { explicit?: string; projects: readonly string[] },
  now = Date.now(),
): { duplicate: boolean; rule: UsageRule; issues: string[] } {
  const started = time(r.startedAt, "startedAt");
  const ended = time(r.endedAt, "endedAt");
  if (ended < started) throw invalid("endedAt_invalid", "endedAt is before startedAt");
  const prior = db.prepare("SELECT id, rule FROM usage_turns WHERE agent = ? AND turn = ?").get(agent, r.turn);
  if (prior) {
    const issues = db
      .prepare("SELECT issue FROM usage_alloc WHERE turn_id = ? ORDER BY issue")
      .all(prior.id)
      .map((x) => String(x.issue));
    return { duplicate: true, rule: String(prior.rule) as UsageRule, issues };
  }

  let rule: UsageRule = "none";
  let issues: string[] = [];
  const inProjects = (ids: string[]) => ids.filter((id) => o.projects.includes(String(issueRow(db, id)?.project ?? "")));
  if (o.explicit && issueRow(db, o.explicit)) {
    rule = "explicit";
    issues = [o.explicit];
  }
  if (rule === "none") {
    const touched = db
      .prepare("SELECT DISTINCT issue FROM activity WHERE actor_kind = 'agent' AND actor_id = ? AND issue IS NOT NULL AND created_at BETWEEN ? AND ? ORDER BY issue")
      .all(agent, started - SLACK_MS, ended + SLACK_MS)
      .map((x) => String(x.issue));
    const found = inProjects(touched);
    if (found.length) {
      rule = "activity";
      issues = found;
    }
  }
  if (rule === "none") {
    const mine = inProjects(
      db
        .prepare("SELECT id FROM issues WHERE assignee_kind = 'agent' AND assignee_id = ? AND status = 'in_progress' ORDER BY id")
        .all(agent)
        .map((x) => String(x.id)),
    );
    if (mine.length === 1) {
      rule = "in_progress";
      issues = mine;
    }
  }

  const id = `use_${ulid(now)}`;
  db.prepare(
    `INSERT INTO usage_turns (id, agent, turn, harness, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, num_turns, rule, started_at, ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    agent,
    r.turn,
    r.harness,
    r.model ?? null,
    r.inputTokens,
    r.outputTokens,
    r.cacheCreationInputTokens ?? 0,
    r.cacheReadInputTokens ?? 0,
    r.costUsd ?? null,
    r.numTurns ?? null,
    rule,
    started,
    ended,
    now,
  );
  for (const issue of issues)
    db.prepare("INSERT INTO usage_alloc (turn_id, issue, project, share) VALUES (?, ?, ?, ?)").run(id, issue, String(issueRow(db, issue)?.project), 1 / issues.length);
  db.prepare("DELETE FROM usage_turns WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM usage_alloc WHERE turn_id = usage_turns.id)").run(now - UNATTRIBUTED_KEEP_MS);
  return { duplicate: false, rule, issues };
}

const SUMS = `COUNT(DISTINCT t.id) AS turns, SUM(t.input_tokens * a.share) AS i, SUM(t.output_tokens * a.share) AS o,
  SUM(t.cache_creation_tokens * a.share) AS cc, SUM(t.cache_read_tokens * a.share) AS cr, SUM(t.cost_usd * a.share) AS cost`;

function totals(r: Record<string, unknown> | undefined): UsageTotals {
  const n = (v: unknown) => Math.round(Number(v ?? 0));
  return {
    turns: Number(r?.turns ?? 0),
    inputTokens: n(r?.i),
    outputTokens: n(r?.o),
    cacheCreationInputTokens: n(r?.cc),
    cacheReadInputTokens: n(r?.cr),
    // SUM over only NULL costs is NULL: "no estimate", not zero
    costUsd: r?.cost === null || r?.cost === undefined ? null : Math.round(Number(r.cost) * 1e6) / 1e6,
  };
}

export function issueUsage(db: Db, issue: string): UsageTotals {
  return totals(db.prepare(`SELECT ${SUMS} FROM usage_alloc a JOIN usage_turns t ON t.id = a.turn_id WHERE a.issue = ?`).get(issue));
}

/** Board view: per issue (only issues with usage), per project, and unattributed per agent. */
export function boardUsage(db: Db, projects: readonly string[]): { byIssue: Record<string, UsageTotals>; byProject: Record<string, UsageTotals>; unattributed: Record<string, UsageTotals> } {
  const byIssue: Record<string, UsageTotals> = {};
  const byProject: Record<string, UsageTotals> = {};
  if (projects.length) {
    const marks = projects.map(() => "?").join(", ");
    for (const r of db.prepare(`SELECT a.issue AS k, ${SUMS} FROM usage_alloc a JOIN usage_turns t ON t.id = a.turn_id WHERE a.project IN (${marks}) GROUP BY a.issue`).all(...projects))
      byIssue[String(r.k)] = totals(r);
    for (const r of db.prepare(`SELECT a.project AS k, ${SUMS} FROM usage_alloc a JOIN usage_turns t ON t.id = a.turn_id WHERE a.project IN (${marks}) GROUP BY a.project`).all(...projects))
      byProject[String(r.k)] = totals(r);
  }
  const unattributed: Record<string, UsageTotals> = {};
  // share 1 per unattributed turn: the same SUMS, joined with a one-row constant share
  for (const r of db
    .prepare(
      `SELECT t.agent AS k, ${SUMS} FROM usage_turns t JOIN (SELECT 1.0 AS share) a WHERE NOT EXISTS (SELECT 1 FROM usage_alloc x WHERE x.turn_id = t.id) GROUP BY t.agent`,
    )
    .all())
    unattributed[String(r.k)] = totals(r);
  return { byIssue, byProject, unattributed };
}
