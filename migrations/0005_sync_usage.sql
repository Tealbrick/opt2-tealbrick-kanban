-- 0.1.14 (C331(6)): an issue imported from an outside tracker (Asana, Trello, Linear, Jira, ...) keeps its reference.
-- Task Board never calls the source: agents (or apps) read and write it through Connect and report here.
-- synced_status = the last status both sides agreed on (set at import and at each sync acknowledgement).
CREATE TABLE issue_external (
  issue TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  system TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  etag TEXT,
  synced_status TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  sync_error TEXT,
  imported_by_kind TEXT NOT NULL,
  imported_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX issue_external_ref ON issue_external (project, system, external_id);

-- 0.1.14 (C331(7), C327): token usage per agent turn, reported by the agent runtime (numbers only, never text).
-- Information only: nothing in Task Board acts on these numbers. cost_usd = the harness's own estimate (NULL if none).
CREATE TABLE usage_turns (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  turn TEXT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cost_usd REAL,
  num_turns INTEGER,
  rule TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX usage_turns_by_turn ON usage_turns (agent, turn);
CREATE INDEX usage_turns_by_agent ON usage_turns (agent, created_at);

-- One row per issue a turn is attributed to; share = 1 / number of issues. No row = unattributed.
CREATE TABLE usage_alloc (
  turn_id TEXT NOT NULL,
  issue TEXT NOT NULL,
  project TEXT NOT NULL,
  share REAL NOT NULL,
  PRIMARY KEY (turn_id, issue)
);
CREATE INDEX usage_alloc_by_issue ON usage_alloc (issue);
CREATE INDEX usage_alloc_by_project ON usage_alloc (project);

-- 0.1.14 (demo gap 7): the one Team board (a shared project made when the workspace has no shared project).
ALTER TABLE projects ADD COLUMN team INTEGER NOT NULL DEFAULT 0;

-- Small app flags (e.g. `team_board_made`: the Team board is made once; an owner who deletes it does not get it back).
CREATE TABLE app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  set_at INTEGER NOT NULL
);
