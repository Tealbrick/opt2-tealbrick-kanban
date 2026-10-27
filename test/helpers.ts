// Test helpers: a migrated node:sqlite database shaped like the SDK `Db`, and a handler context with a fake scope view.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { type CrudAction, eventDecl, eventScopeType, validateEventPayload } from "@opt2-tealbrick/manifest";
import type { Db, OpContext } from "@opt2-tealbrick/miniapp-sdk";

export function migratedDb(): Db {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(f, dir), "utf8"));
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const out = fn();
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return db as unknown as Db;
}

export const CRUD = {
  read: ["read"],
  contribute: ["read", "create", "update"],
  manage: ["read", "create", "update", "delete"],
} as const satisfies Record<string, readonly CrudAction[]>;

export interface FakeCaller {
  type: "agent" | "app" | "person";
  id: string;
  name: string;
  mode?: "free" | "bound";
}

/** A handler context: `access` maps project id → CRUD set (ignored for person callers, who may act everywhere). */
export function ctxFor(
  db: Db,
  caller: FakeCaller,
  access: Record<string, readonly CrudAction[]> = {},
  callApp?: OpContext["callApp"],
): OpContext & { instances: { type: string; id: string; label: string; shared?: boolean }[] } {
  const person = caller.type === "person";
  const instances: { type: string; id: string; label: string; shared?: boolean }[] = [];
  return {
    db,
    caller: { ...caller, mode: caller.type === "agent" ? (caller.mode ?? "free") : null },
    scope: {
      access: null,
      readable: async () => (person ? [] : Object.keys(access).filter((p) => access[p]?.includes("read"))),
      writable: async () => (person ? [] : Object.keys(access).filter((p) => access[p]?.some((c) => c !== "read"))),
      can: async (_t: string, id: string, crud: CrudAction) => person || (access[id]?.includes(crud) ?? false),
    },
    scopes: {
      instances: {
        create: async (type: string, id: string, label: string, opts?: { shared?: boolean }) => {
          instances.push({ type, id, label, shared: opts?.shared });
          return { type, id, label, shared: opts?.shared ?? false };
        },
        list: async () => [],
      },
    },
    callApp: callApp ?? (async () => Promise.reject(new Error("no companion in this test"))),
    instances,
  } as unknown as OpContext & { instances: { type: string; id: string; label: string; shared?: boolean }[] };
}

/** One `ctx.emit` call that committed (the fake outbox keeps it in a table of the same database). */
export interface Emitted {
  name: string;
  data: Record<string, unknown>;
  subject: { kind: string; id: string };
  to: string[];
  instanceId: string;
  summary?: string;
  untrusted?: boolean;
}

/**
 * A context with a fake `ctx.emit` / `ctx.purgeEvents` that behaves like the SDK outbox (SDK-API §20): it validates the emit
 * against the manifest declaration (name, payloadSchema, `to` = 1..100 agent ids, summary ≤ 280, scoped → instanceId) and
 * throws like the SDK on a bad one, refuses an emit outside a transaction (Task Board always emits inside the change's
 * transaction), and writes a row in the SAME database, so a rolled-back change leaves no event. `emitted()` / `purged()`
 * read the committed rows.
 */
export function withEvents<C extends OpContext>(ctx: C, manifest: Parameters<typeof eventDecl>[0] & Parameters<typeof eventScopeType>[0]): C & { emitted(): Emitted[]; purged(): string[] } {
  const raw = ctx.db;
  raw.exec("CREATE TABLE IF NOT EXISTS test_outbox (n INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL)");
  let depth = 0;
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction<T>(fn: () => T): T {
      depth++;
      try {
        return raw.transaction(fn);
      } finally {
        depth--;
      }
    },
  } as unknown as Db;
  const fail = (code: string, why: string) => Object.assign(new Error(`${code}: ${why}`), { code });
  const emit = (name: string, data: unknown, opts: Record<string, unknown>) => {
    if (depth === 0) throw new Error(`emit ${name} outside a transaction`);
    const decl = eventDecl(manifest, name);
    if (!decl || decl.platform) throw fail("event_undeclared", name);
    const p = validateEventPayload(decl, data);
    if (!p.ok) throw fail(p.code, JSON.stringify(p.errors));
    const to = opts.to as unknown;
    if (decl.audience === "target" && (!Array.isArray(to) || to.length < 1 || to.length > 100 || !to.every((a) => typeof a === "string" && /^agt_[0-9A-HJKMNP-TV-Z]{26}$/.test(a))))
      throw fail("event_target_invalid", JSON.stringify(to));
    if (typeof opts.summary === "string" && opts.summary.length > 280) throw fail("event_too_large", "summary");
    if ((eventScopeType(manifest, decl) !== null) !== (typeof opts.instanceId === "string")) throw fail("event_instance_invalid", String(opts.instanceId));
    raw.prepare("INSERT INTO test_outbox (kind, body) VALUES ('emit', ?)").run(JSON.stringify({ name, data, ...opts }));
  };
  const purgeEvents = (instanceId: string) => {
    if (depth === 0) throw new Error("purgeEvents outside a transaction");
    raw.prepare("INSERT INTO test_outbox (kind, body) VALUES ('purge', ?)").run(JSON.stringify({ instanceId }));
  };
  const rows = (kind: string) =>
    raw
      .prepare("SELECT body FROM test_outbox WHERE kind = ? ORDER BY n")
      .all(kind)
      .map((r) => JSON.parse(String(r.body)));
  return Object.assign(ctx, {
    db,
    emit,
    purgeEvents,
    emitted: () => rows("emit") as Emitted[],
    purged: () => rows("purge").map((r: { instanceId: string }) => r.instanceId),
  }) as C & { emitted(): Emitted[]; purged(): string[] };
}
