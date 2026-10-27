-- Task Board 0.1.14 app.db (schema + rows), made by test/upgrade/make-fixture.ts. Do not edit by hand.
CREATE TABLE tb_migrations (scope TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY (scope, version)) STRICT;
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('sdk', 1, '7c1cbdbed6ef6d0589605eb626550f7c115beb12cd247ff93f0e18bb105f15b4', 1793063165939, 'sdk_baseline');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('sdk', 2, 'f3de91c8b9347e576def6d06364dc9d94d717d2d54bc80fa0f084b3fbf2fac3d', 1793063165940, 'sdk_app_secrets');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('sdk', 3, 'cbda36d4b9f4c922b5384ea15f30e3f56d37fbe7374401de90c96b9e98295d4e', 1793063165940, 'sdk_receipt_held_by');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('sdk', 4, '9c0627c54d4701cb07fdd4f77ad07000e791e6ed18f84de777818a8492eb9667', 1793063165941, 'sdk_jobs');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('sdk', 5, '8eeceb8edcb504b568c636e0eefd4ef9131fca2b45224488ad8b06fb1e39b788', 1793063165941, 'sdk_cap_usage');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('app', 1, '7db94c1a07f56662c8041d0a04afcedacec173ab22093a68fc5313cf9d584513', 1793063165942, 'init');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('app', 2, 'abf708b882d47b1db44973998b035e3341a9b97d2b960b1fa331cde2632ff407', 1793063165943, 'share_grants');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('app', 3, 'ba8d9b7c18523d3eee620fa5fd852a3bf10503a921bd42d5c90600cf470c67bc', 1793063165943, 'drop_share_grants');
INSERT INTO "tb_migrations" ("scope", "version", "sha256", "applied_at", "name") VALUES ('app', 4, 'dc6a268694a5fc95b6c258fac7d75a26c11e58bb692a62120c605c230a62f57b', 1793063165943, 'apps');
CREATE TABLE tb_migration_lock (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, until INTEGER NOT NULL) STRICT;
CREATE TABLE tb_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT INTO "tb_meta" ("key", "value") VALUES ('app_version', '"0.1.14"');
INSERT INTO "tb_meta" ("key", "value") VALUES ('schema', '{"app":4,"sdk":5}');
INSERT INTO "tb_meta" ("key", "value") VALUES ('min_compatible_code', '"0.1.14"');
INSERT INTO "tb_meta" ("key", "value") VALUES ('min_compatible_sdk', '"0.1.25"');
INSERT INTO "tb_meta" ("key", "value") VALUES ('backup_state', '{"since":1793063165953,"lastOkAt":null,"lastFailedAt":null,"lastError":null,"failures":0}');
CREATE TABLE tb_receipts (
  id TEXT PRIMARY KEY, call_id TEXT, caller_type TEXT NOT NULL, caller_id TEXT NOT NULL, caller_name TEXT NOT NULL,
  op TEXT NOT NULL, effect TEXT NOT NULL, hold_family TEXT, status TEXT NOT NULL, input_digest TEXT NOT NULL,
  summary TEXT NOT NULL, meta TEXT NOT NULL, idempotency_key TEXT, view TEXT,
  created_at INTEGER NOT NULL, decided_at INTEGER, expires_at INTEGER, decided_by TEXT, consumed INTEGER NOT NULL DEFAULT 0
, held_by TEXT, hold_reason TEXT) STRICT;
CREATE TABLE tb_idempotency (
  caller_id TEXT NOT NULL, op TEXT NOT NULL, key TEXT NOT NULL, input_digest TEXT NOT NULL,
  kind TEXT NOT NULL, output TEXT, hold_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY (caller_id, op, key)
) STRICT;
CREATE TABLE tb_scope_instances (
  type TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, owner_agent TEXT,
  created_at INTEGER NOT NULL, PRIMARY KEY (type, id)
) STRICT;
CREATE TABLE tb_scopes (agent TEXT NOT NULL, type TEXT NOT NULL, instance_id TEXT NOT NULL, access TEXT NOT NULL,
  PRIMARY KEY (agent, type, instance_id)) STRICT;
CREATE TABLE tb_scope_defaults (agent TEXT NOT NULL, type TEXT NOT NULL, applied_at INTEGER NOT NULL,
  PRIMARY KEY (agent, type)) STRICT;
CREATE TABLE tb_agents (agent TEXT PRIMARY KEY, name TEXT NOT NULL, first_seen INTEGER NOT NULL, in_slice INTEGER NOT NULL) STRICT;
CREATE TABLE tb_sessions (digest TEXT PRIMARY KEY, person TEXT NOT NULL, ws TEXT NOT NULL, instance TEXT NOT NULL,
  iss TEXT NOT NULL, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
CREATE TABLE tb_used_jti (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL) STRICT;
CREATE TABLE tb_keys (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE tb_audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, detail TEXT NOT NULL) STRICT;
INSERT INTO "tb_audit" ("id", "at", "actor", "action", "target", "detail") VALUES ('aud_01M5XE97ZR0TP3MKJRX3FBA4AP', 1793063165944, 'system', 'migration.apply', '0001_init', 'null');
INSERT INTO "tb_audit" ("id", "at", "actor", "action", "target", "detail") VALUES ('aud_01M5XE97ZR0TP3MKJRX3FBA4AQ', 1793063165944, 'system', 'migration.apply', '0002_share_grants', 'null');
INSERT INTO "tb_audit" ("id", "at", "actor", "action", "target", "detail") VALUES ('aud_01M5XE97ZR0TP3MKJRX3FBA4AR', 1793063165944, 'system', 'migration.apply', '0003_drop_share_grants', 'null');
INSERT INTO "tb_audit" ("id", "at", "actor", "action", "target", "detail") VALUES ('aud_01M5XE97ZR0TP3MKJRX3FBA4AS', 1793063165944, 'system', 'migration.apply', '0004_apps', 'null');
CREATE TABLE tb_secrets (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE tb_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, dedupe TEXT UNIQUE, key TEXT, input TEXT NOT NULL, input_digest TEXT NOT NULL,
  state TEXT, status TEXT NOT NULL, run_at INTEGER NOT NULL, cron TEXT, op TEXT,
  caller_type TEXT, caller_id TEXT, caller_name TEXT, caller_mode TEXT, grant_sealed TEXT, grant_iat INTEGER,
  hold_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, lease_ms INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, last_error TEXT, result TEXT, paused_by TEXT,
  runs INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER
) STRICT;
CREATE TABLE tb_cap_usage (
  id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, effect TEXT NOT NULL, op TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL
);
INSERT INTO "agents" ("id", "name", "mode", "active", "first_seen") VALUES ('agt_01JA0000000000000000000HEN', 'Henry', 'free', 1, 1792486800000);
INSERT INTO "agents" ("id", "name", "mode", "active", "first_seen") VALUES ('agt_01JA0000000000000000000TMP', 'Tempo', 'bound', 1, 1792486860000);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  shared INTEGER NOT NULL DEFAULT 0,
  owner_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO "projects" ("id", "name", "summary", "shared", "owner_agent", "created_at", "updated_at") VALUES ('agt_01JA0000000000000000000HEN', 'Henry work', '', 0, 'agt_01JA0000000000000000000HEN', 1792486980000, 1792486980000);
INSERT INTO "projects" ("id", "name", "summary", "shared", "owner_agent", "created_at", "updated_at") VALUES ('agt_01JA0000000000000000000TMP', 'Tempo work', '', 0, 'agt_01JA0000000000000000000TMP', 1792487040000, 1792487040000);
INSERT INTO "projects" ("id", "name", "summary", "shared", "owner_agent", "created_at", "updated_at") VALUES ('prj_01JA0000000000000000000TEAM', 'Team board', 'shared', 1, NULL, 1792487100000, 1792487100000);
INSERT INTO "projects" ("id", "name", "summary", "shared", "owner_agent", "created_at", "updated_at") VALUES ('prj_01JA0000000000000000000LNCH', 'Launch', 'private', 0, NULL, 1792487160000, 1792487160000);
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO "goals" ("id", "project", "title", "summary", "horizon", "status", "created_at", "updated_at") VALUES ('gol_01M5XE98036019FQGW94VJKNVW', 'prj_01JA0000000000000000000TEAM', 'Ship 0.2', 'release', 'short', 'active', 1792487220000, 1792487220000);
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  assignee_kind TEXT,
  assignee_id TEXT,
  goal TEXT,
  template TEXT,
  blocked_reason TEXT,
  result TEXT,
  created_by_kind TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNVY', 'prj_01JA0000000000000000000TEAM', 'Write the spec', 'doc', 'done', 'high', 'agent', 'agt_01JA0000000000000000000HEN', 'gol_01M5XE98036019FQGW94VJKNVW', NULL, NULL, 'Spec in docs/spec.md', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 1792487280000, 1792487880000, 1792487880000);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNW0', 'prj_01JA0000000000000000000TEAM', 'Build it', '', 'todo', 'medium', 'agent', 'agt_01JA0000000000000000000TMP', NULL, 'build', NULL, NULL, 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 1792487340000, 1792487700000, NULL);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNW2', 'prj_01JA0000000000000000000TEAM', 'Owner task', '', 'backlog', 'low', 'owner', 'owner', NULL, NULL, NULL, NULL, 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 1792487400000, 1792487400000, NULL);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNW4', 'prj_01JA0000000000000000000TEAM', 'Needs a key', '', 'blocked', 'medium', 'agent', 'agt_01JA0000000000000000000HEN', NULL, NULL, 'Waiting for the API key', NULL, 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 1792487460000, 1792487520000, NULL);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNW7', 'prj_01JA0000000000000000000TEAM', 'Review copy', '', 'in_review', 'medium', 'agent', 'agt_01JA0000000000000000000TMP', NULL, NULL, NULL, NULL, 'app', 'ins_01JA0000000000000000000OBS', 'Observer', 1792487580000, 1792487640000, NULL);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNWH', 'agt_01JA0000000000000000000HEN', 'Private step', '', 'in_progress', 'medium', 'agent', 'agt_01JA0000000000000000000HEN', NULL, NULL, NULL, NULL, 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 1792487940000, 1792487940000, NULL);
INSERT INTO "issues" ("id", "project", "title", "summary", "status", "priority", "assignee_kind", "assignee_id", "goal", "template", "blocked_reason", "result", "created_by_kind", "created_by_id", "created_by_name", "created_at", "updated_at", "completed_at") VALUES ('iss_01M5XE98036019FQGW94VJKNWK', 'prj_01JA0000000000000000000LNCH', 'Unassigned launch work', '', 'todo', 'medium', NULL, NULL, NULL, NULL, NULL, NULL, 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 1792488000000, 1792488000000, NULL);
CREATE TABLE issue_links (
  issue TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issue, depends_on)
);
INSERT INTO "issue_links" ("issue", "depends_on", "created_at") VALUES ('iss_01M5XE98036019FQGW94VJKNW0', 'iss_01M5XE98036019FQGW94VJKNVY', 1792487340000);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  issue TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO "comments" ("id", "issue", "author_kind", "author_id", "author_name", "body", "created_at") VALUES ('cmt_01M5XE98036019FQGW94VJKNWA', 'iss_01M5XE98036019FQGW94VJKNW0', 'agent', 'agt_01JA0000000000000000000TMP', 'Tempo', 'Starting after the spec', 1792487700000);
INSERT INTO "comments" ("id", "issue", "author_kind", "author_id", "author_name", "body", "created_at") VALUES ('cmt_01M5XE98036019FQGW94VJKNWC', 'iss_01M5XE98036019FQGW94VJKNVY', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'Owner note', 1792487760000);
CREATE TABLE issue_documents (
  issue TEXT NOT NULL,
  document TEXT NOT NULL,
  title TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (issue, document)
);
INSERT INTO "issue_documents" ("issue", "document", "title", "linked_at") VALUES ('iss_01M5XE98036019FQGW94VJKNVY', 'doc_01JA0000000000000000000SPC', 'Spec draft', 1792487820000);
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  issue TEXT,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVR', 'agt_01JA0000000000000000000HEN', NULL, 'app', 'kanban', 'Kanban', 'project_created', 'Project "Henry work" created', 1792486980000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVS', 'agt_01JA0000000000000000000TMP', NULL, 'app', 'kanban', 'Kanban', 'project_created', 'Project "Tempo work" created', 1792487040000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVT', 'prj_01JA0000000000000000000TEAM', NULL, 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'project_created', 'Project "Team board" created', 1792487100000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVV', 'prj_01JA0000000000000000000LNCH', NULL, 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'project_created', 'Project "Launch" created', 1792487160000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVX', 'prj_01JA0000000000000000000TEAM', NULL, 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'goal_created', 'Goal "Ship 0.2" created', 1792487220000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNVZ', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNVY', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'issue_created', 'Created "Write the spec" in todo for Henry', 1792487280000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW1', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW0', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'issue_created', 'Created "Build it" in todo for Tempo', 1792487340000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW3', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW2', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'issue_created', 'Created "Owner task" in backlog for Owner', 1792487400000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW5', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW4', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'issue_created', 'Created "Needs a key" in todo for Henry', 1792487460000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW6', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW4', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'blocked', 'status todo → blocked; blocked: Waiting for the API key', 1792487520000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW8', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW7', 'app', 'ins_01JA0000000000000000000OBS', 'Observer', 'issue_created', 'Created "Review copy" in todo for Tempo', 1792487580000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNW9', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW7', 'agent', 'agt_01JA0000000000000000000TMP', 'Tempo', 'moved', 'status todo → in_review', 1792487640000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWB', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW0', 'agent', 'agt_01JA0000000000000000000TMP', 'Tempo', 'commented', 'Comment: Starting after the spec', 1792487700000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWD', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNVY', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'commented', 'Comment: Owner note', 1792487760000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWE', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNVY', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'document_linked', 'Document "Spec draft" linked', 1792487820000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWF', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNVY', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'completed', 'status todo → done; result: Spec in docs/spec.md', 1792487880000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWG', 'prj_01JA0000000000000000000TEAM', 'iss_01M5XE98036019FQGW94VJKNW0', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'promoted', 'Ready: "Write the spec" is done', 1792487880000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWJ', 'agt_01JA0000000000000000000HEN', 'iss_01M5XE98036019FQGW94VJKNWH', 'agent', 'agt_01JA0000000000000000000HEN', 'Henry', 'issue_created', 'Created "Private step" in in_progress for Henry', 1792487940000);
INSERT INTO "activity" ("id", "project", "issue", "actor_kind", "actor_id", "actor_name", "kind", "summary", "created_at") VALUES ('act_01M5XE98036019FQGW94VJKNWM', 'prj_01JA0000000000000000000LNCH', 'iss_01M5XE98036019FQGW94VJKNWK', 'owner', 'per_01JA0000000000000000000MAR', 'Owner', 'issue_created', 'Created "Unassigned launch work" in todo', 1792488000000);
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  name TEXT,
  last_seen INTEGER NOT NULL
);
INSERT INTO "apps" ("id", "name", "last_seen") VALUES ('ins_01JA0000000000000000000OBS', 'Observer', 1792486920000);
CREATE INDEX tb_receipts_match ON tb_receipts (caller_id, op, input_digest, status);
CREATE INDEX tb_receipts_status ON tb_receipts (status, expires_at);
CREATE INDEX tb_receipts_usage ON tb_receipts (caller_id, effect, created_at);
CREATE INDEX tb_receipts_order ON tb_receipts (created_at, id);
CREATE INDEX tb_receipts_call ON tb_receipts (call_id);
CREATE INDEX tb_audit_order ON tb_audit (at, id);
CREATE INDEX tb_jobs_due ON tb_jobs (status, run_at);
CREATE INDEX tb_jobs_lease ON tb_jobs (status, lease_until);
CREATE INDEX tb_jobs_caller ON tb_jobs (caller_id, status);
CREATE INDEX tb_jobs_hold ON tb_jobs (hold_id);
CREATE INDEX tb_jobs_order ON tb_jobs (created_at, id);
CREATE INDEX tb_cap_usage_count ON tb_cap_usage (caller_id, effect, created_at);
CREATE INDEX goals_by_project ON goals (project, created_at);
CREATE INDEX issues_by_project ON issues (project, status);
CREATE INDEX issues_by_assignee ON issues (assignee_id, status);
CREATE INDEX issues_by_template ON issues (template, status);
CREATE INDEX issue_links_reverse ON issue_links (depends_on);
CREATE INDEX comments_by_issue ON comments (issue, created_at);
CREATE INDEX activity_by_project ON activity (project, created_at DESC, id DESC);
CREATE INDEX activity_by_issue ON activity (issue, created_at DESC, id DESC);
