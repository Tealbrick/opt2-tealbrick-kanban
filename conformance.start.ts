// Conformance harness (CONFORMANCE §2, app target): `tb-conformance app --start conformance.start.ts` boots the app with
// the env the suite gives it (fake bridge, enrolment code, TB_KEK, data dir) and drives it like the bridge does. The SDK
// listens on manifest `runtime.port` (SDK-API §13); `backupNow` lets the suite run the backup/restore round-trip (A7).
// `--test-roots` (C63): the suite passes TEST Portal Root Keys in TBCONF_PORTAL_ROOT_KEYS; only this harness reads it and
// hands them to startApp, so the key-set checks (A13) run against test roots. Production never reads that variable.
import { applyLevelCrud, LEVEL_CRUD_ENV, parseLevelCrud } from "@opt2-tealbrick/conformance";
import { defineApp, type HandlerSpec, type OpContext, startApp } from "@opt2-tealbrick/miniapp-sdk";
import { definition, manifest } from "./src/app.ts";
import { PROJECT_SCOPE } from "./src/board.ts";
import { EVENT } from "./src/events.ts";

const AGENT_ID = /^agt_[0-9A-HJKMNP-TV-Z]{26}$/;

interface ProbeInput {
  case: "emit" | "rollback" | "commit_throw" | "invalid" | "scoped" | "purge" | "grant";
  key?: string;
  instanceId?: string;
  kind?: "payload" | "undeclared" | "reserved";
  agent?: string;
  access?: string;
}

/**
 * The `eventsProbe` op of tealbrick-conformance.json (conformance >= 0.1.28, SDK-API §20, A-EV-1..8). Production serves a
 * handler that refuses every call (src/app.ts); only this harness runs the real probe. Every Task Board event is scoped on a
 * project and targeted, so "emit" and "scoped" both send one `issue.assigned` for the fixture project; `to` = every directory
 * agent (the SDK intersects it with the agents whose row on that project admits issue_get, which A-EV-6 checks).
 */
async function eventsProbe(input: ProbeInput, ctx: OpContext): Promise<{ code?: string | null }> {
  const emit = ctx.emit;
  if (!emit) throw new Error("the SDK gave no ctx.emit (SDK >= 0.1.38 sets it)");
  const instanceId = input.instanceId ?? "";
  const to = ctx.db
    .prepare("SELECT id FROM agents WHERE active = 1 ORDER BY first_seen, id")
    .all()
    .map((r) => String(r.id))
    .filter((id) => AGENT_ID.test(id))
    .slice(0, 100);
  const one = (status: string) =>
    emit(EVENT.assigned, { projectId: instanceId, status, reason: "created", by: { kind: "owner", id: ctx.caller.id } }, {
      subject: { kind: "issue", id: "iss_conformance_probe" },
      to: to as never,
      instanceId,
      summary: "Conformance probe",
      untrusted: true,
      ...(input.key ? { key: input.key } : {}),
    });
  switch (input.case) {
    case "emit":
    case "scoped":
      ctx.db.transaction(() => one("todo"));
      return {};
    case "rollback":
      try {
        ctx.db.transaction(() => {
          one("todo");
          throw new Error("rolled back on purpose");
        });
      } catch {
        // the A-EV-2 rollback case: the transaction (and its outbox row) is gone
      }
      return {};
    case "commit_throw":
      ctx.db.transaction(() => one("todo"));
      throw new Error("the probe fails after its transaction committed");
    case "invalid":
      try {
        if (input.kind === "payload") one("not_a_status");
        else if (input.kind === "undeclared") emit("issue.unknown", {}, { subject: { kind: "issue", id: "iss_conformance_probe" }, to: to as never, instanceId });
        else emit("tb.hold.decided", {}, { subject: { kind: "hold", id: "hld_conformance_probe" } });
      } catch (e) {
        return { code: (e as { code?: string }).code ?? null };
      }
      return { code: null };
    case "purge":
      ctx.db.transaction(() => ctx.purgeEvents?.(instanceId));
      return {};
    case "grant":
      if (!ctx.scopeGrants) throw new Error("ctx.scopeGrants is set for person calls only");
      await ctx.scopeGrants.grant(String(input.agent) as never, PROJECT_SCOPE, instanceId, String(input.access));
      return {};
  }
}

export default async function start(env: Record<string, string>): Promise<{ url: string; stop(): Promise<void>; backupNow(): Promise<void> }> {
  // A21 (conformance >= 0.1.25, C283b/C283c): the suite simulates an app update that widens or narrows an access level through
  // TBCONF_LEVEL_CRUD; the harness serves the manifest with that change applied (absent or malformed = unchanged).
  const served = applyLevelCrud(manifest as unknown as Parameters<typeof applyLevelCrud>[0], parseLevelCrud(env[LEVEL_CRUD_ENV] ?? process.env[LEVEL_CRUD_ENV])) as unknown as typeof manifest;
  const probe: HandlerSpec = { run: (input, ctx) => eventsProbe(input as unknown as ProbeInput, ctx) as never };
  const app = defineApp({ ...definition, manifest: served, handlers: { ...definition.handlers, events_probe: probe } });
  // Port: the suite's free port (TBCONF_PORT, conformance >= 0.1.13), else manifest runtime.port.
  const harness = {
    ...(env.TBCONF_PORTAL_ROOT_KEYS ? { portalRootKeys: JSON.parse(env.TBCONF_PORTAL_ROOT_KEYS) } : {}),
    port: env.TBCONF_PORT ? Number(env.TBCONF_PORT) : manifest.runtime.port,
  } as Parameters<typeof startApp>[2];
  const running = await startApp(app, env, harness);
  return {
    url: `http://127.0.0.1:${running.port}`,
    stop: () => running.stop(),
    backupNow: async () => {
      await running.backups.runNow();
    },
  };
}
