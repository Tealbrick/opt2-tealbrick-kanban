# Task Board (Tealbrick mini app): architecture

State: verified against the repo on 2026-10-17. Claims cite paths in this repo. Anything not verified is marked UNVERIFIED. For the whole system see `engineering/ARCHITECTURE.md` and `engineering/SYSTEM-OVERVIEW.md` in the private repo `Tealbrick/opt2-tealbrick-docs`.

## Common app pattern (verified for all seven apps)

- **Runtime**: Node 24, TypeScript run through `tsc` to `dist/`, UI built by `scripts/build-ui.ts` (no bundler; content-hashed `assets-<hash>/`). The app is started by `startApp` from `@opt2-tealbrick/miniapp-sdk` (`src/main.ts`).
- **Dockerfile**: two stages on `node:24-slim` pinned by digest, `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run build && pnpm prune --prod`, the manifest also copied to `/opt/tb/tealbrick.manifest.json` (the `tb-exec` default), `USER node`, no `VOLUME`. The SDK drops root to uid 1000 itself when the platform starts the container as root (Railway volumes are root-owned).
- **Data**: one SQLite file `TB_DATA_DIR/app.db` owned by the SDK. App tables use their own prefix; SDK tables use `tb_*`. On Railway there is ONE volume per service: the backup directory is `<data mount>/backup`, so the volume size is data plus backup (C28).
- **Migrations**: `migrations/NNNN_name.sql` (or `.ts` exporting `up(db)`). The SDK enforces forward-only: gap-free from 0001, one transaction each, sha256 recorded in `tb_migrations`. A changed, missing, misnamed or `down` migration stops the app with `migration_invalid`.
- **Backups and restore**: SDK cron runner writes `tb-backup-<UTC>.tar.gz`; export `tealbrick.export/1` never carries the instance key, KEK, keys, secrets or sessions. Restore at next boot with `TB_RESTORE_FROM`.
- **Authorization**: the bridge gates (`gate()`); the SDK decides (`authorize()`): run, hold or refuse. Holds and receipts live in the app's own `tb_receipts` table. Raw call input is never stored, only a digest.
- **Manifest** `tealbrick.manifest.json` is the only source for operations, scopes, settings, hooks, companions, skills, runtime hints, backups and UI paths. Schema `tealbrick.miniapp/2`, `sdkMajor 1`, `source.license Apache-2.0`. Agent ops become MCP tools `<product>__<op>`. Person ops are owner UI only.
- **Generated**: `gen/` (openapi, kit, docs, railway) is produced by `tb-gen` and is not committed. The typed client kit is built into `dist/kit` and imported as `#kit` in apps that have one.
- **Standard UI pages** (from the kit `AppShell`): Holds, Receipts, Agents and scopes, Keys (where the app has keys), Backups and export.
- **Licence files**: `LICENSE` (Apache-2.0), `NOTICE`, `THIRD_PARTY_NOTICES.md`. The brand mark and app art are Tealbrick artwork and are not Apache-licensed.
- **Private by design**: no public address. Only the bridge is public.

## Task Board: what it does

An issue is "ready" when it is `todo` and every `dependsOn` is done. Readiness is computed, never stored (a `promoted` activity entry is written). The author of every issue, comment and activity is the verified caller (agent, companion app shown as "<name> (app)", or owner), never free text. Kanban stores document references only (id and title the agent supplies). It never reads Knowledge (no confused deputy, C88).

## Operations (from `tealbrick.manifest.json`)

38 operations.
- Read (agent, per project): `projects_list`, `project_get`, `goals_list`, `issues_list` (filter `template`, a lowercase key for repeated work; Evolution's detector relies on it), `issue_get`, `activity_list`, `work_next`, `sync_pending`.
- Write (agent): `issues_import`, `issue_sync_ack`, `usage_report`, `project_update`, `goal_create`, `goal_update`, `issue_create`, `issue_update`, `issue_comment_add`, `issue_link`, `issue_unlink`, `issue_block`, `issue_complete`, `issue_document_link`, `issue_document_unlink`.
- Destructive, hold `destructive`: `project_delete`, `goal_delete`, `issue_delete`.
- Person: `board_view`, `board_issue`, 8 writes, 2 destructive (held).

## Scopes, hooks and companions

- **Scopes:** `project` (access `read`, `contribute`, `manage`). Default grants: own project manage, shared project contribute. `needsAgentDirectory: true`: each agent gets its own project on first sight; owner projects can be shared with every agent, current and later.
- **Hooks:** None.
- **Companion grants it asks for:** None. Consumers: Evolution calls `issues_list`, `issue_create`, `issue_complete`, `issue_block`.

## Settings, keys and environment

None. No keys and no app-specific environment variables.

## Data

- **Stored:** Migrations 0001 to 0005: `agents`, `projects` (`team` marks the Team board), `goals`, `issues` (author kind, id, name; template; blocked reason; result), `issue_links`, `comments`, `issue_documents` (document id and title only), `activity`, `apps` (verified names of companion-app callers), `issue_external` (source system, card id, https link, etag, last agreed status, last sync error), `usage_turns` + `usage_alloc` (token numbers per agent turn and the issues it is attributed to), `app_flags`.
- **Never stored:** Knowledge document bodies; prompts, replies or tool text of agent turns (usage rows are numbers, model name and ids only).

## External calls and background work

- **External:** None. Outside trackers (Asana, Trello, ...) are read and changed by agents through Connect; Task Board only stores what they import (C88, C322(10)).
- **Background:** None (no timers). On start, the Team board is made once when the workspace has no shared project (demo gap 7).

## Person UI

Board (six columns; drag changes status), Holds, Receipts, Agents and scopes (`/configure`), Backups and export (`src/ui/App.tsx`). No Keys page.

## Requirements and runtime hints

A bridge for agent access. Standalone mode gives a person-only UI. Agents are told to call `kanban__work_next` first (manifest `harnessHints`).

Port 8080. 0.25 cpu, 256 MB. Data 1 GB plus backup 2 GB (3 GB merged). Backup cron `41 2 * * *`, retain 14.

## Pinned packages

miniapp-sdk 0.1.25, manifest 0.1.18, conformance 0.1.18, ui 0.2.4 (no direct spec dependency).

All `@opt2-tealbrick/*` pins use dist-host tarball URLs. Upgrade safety (SDK 0.1.25: pre-update snapshot, migration lock, failed mode) is in this app on `main` (0.1.13, dev channel; its qa1 soak is the gate for stable, C221). The stable release 0.1.12 pins SDK 0.1.22, so Core can roll back an update of that version only as an image (no data restore) until a stable version with SDK 0.1.25 ships (after the qa1 soak).

## Outside trackers and token use (0.1.14)

- **Import (C331(6))**: `issues_import` is the one sink for every path (agents now; Observer or an owner import over a Connect `tasks/1` dataset later). Key = (project, system, externalId). Same etag = unchanged; a changed etag updates title/summary; a changed source status applies only while the board still has the last agreed status, else `conflict` and the board keeps its status. `sync_pending` lists cards done here and not done in the source; the agent updates the source through Connect and calls `issue_sync_ack` (or sends `error`).
- **Token use (C331(7), C327)**: the agent runtime (`tealbrick agent serve`) calls `usage_report` after each turn. Attribution: the issue named, else the issues the agent changed during the turn (split evenly), else its single in-progress issue, else unattributed per agent. Totals on `issue_get`, `board_issue`, `board_view`. Information only: no budget, warning or hold reads these numbers. Unattributed turns are pruned after 90 days; an issue's usage goes with the issue.
- **Team board**: one shared project made once when the workspace has none, so every agent (and a read-only reader) sees shared work without per-project owner grants. `board_view {project: "all"}` shows every project.

## Known gaps

None known in this document.