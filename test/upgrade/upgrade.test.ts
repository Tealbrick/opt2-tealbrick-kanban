// Upgrade test (DONE-DEFINITION §3.3, UPGRADE-SAFETY M7 style): a data directory written by an OLDER Task Board (fixtures made
// by test/upgrade/make-fixture.ts from that version's own code and SDK) boots on the CURRENT code. The SDK applies its newer
// schema steps (incl. the event outbox, SDK-API §20) and the app migrations that are missing; every issue reads the same as
// the old version showed it. Versions: 0.1.14 (stable / ostra: 0.1.13 code + Node image) and 0.1.14-dev.1 (dev channel).
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { defineApp, startApp } from "@opt2-tealbrick/miniapp-sdk";
import { definition, manifest } from "../../src/app.ts";
import { toIssue } from "../../src/board.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a ? a.port : 0));
    });
  });
}

const fixtures = new URL("./fixtures/", import.meta.url);
const appMigrations = readdirSync(new URL("../../migrations/", import.meta.url)).filter((f) => /^\d{4}_.+\.(sql|ts)$/.test(f)).length;

for (const from of ["0.1.14", "0.1.14-dev.1"]) {
  test(`upgrade from ${from}: SDK schema with the event outbox, app migrations, issues read the same`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), `kanban-upgrade-${from}-`));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const seed = new DatabaseSync(join(dir, "app.db"));
    seed.exec(readFileSync(new URL(`kanban-${from}.sql`, fixtures), "utf8"));
    const before = seed.prepare("SELECT scope, MAX(version) AS v FROM tb_migrations GROUP BY scope ORDER BY scope").all();
    const rowsBefore = Number(seed.prepare("SELECT COUNT(*) AS n FROM issues").get()?.n);
    seed.close();
    assert.ok(!before.some((r) => r.scope === "sdk" && Number(r.v) >= 11), "the fixture predates the outbox");

    const port = await freePort();
    const running = await startApp(defineApp({ ...definition, manifest: { ...manifest, runtime: { ...manifest.runtime, port } } }), {
      TB_DATA_DIR: dir,
      TB_STANDALONE: "1",
      TB_LOG_LEVEL: "error",
    });
    try {
      const health = (await (await fetch(`http://127.0.0.1:${port}/tb/v1/health`)).json()) as { status: string };
      assert.equal(health.status, "ok");
    } finally {
      await running.stop();
    }

    const raw = new DatabaseSync(join(dir, "app.db"));
    t.after(() => raw.close());
    const db = { exec: (s: string) => raw.exec(s), prepare: (s: string) => raw.prepare(s) } as never;
    const schema = Object.fromEntries(raw.prepare("SELECT scope, MAX(version) AS v FROM tb_migrations GROUP BY scope").all().map((r) => [String(r.scope), Number(r.v)]));
    assert.equal(schema.app, appMigrations, "every app migration applied");
    assert.ok(schema.sdk !== undefined && schema.sdk >= 11, `SDK schema ${schema.sdk} includes step 11 (event outbox)`);
    assert.ok(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tb_event_outbox'").get(), "tb_event_outbox exists");
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS n FROM tb_event_outbox WHERE kind = 'emit'").get()?.n), 0, "an update emits no app event");

    const expected = JSON.parse(readFileSync(new URL(`kanban-${from}.issues.json`, fixtures), "utf8")) as Record<string, unknown>[];
    const rows = raw.prepare("SELECT * FROM issues ORDER BY id").all();
    assert.equal(rows.length, rowsBefore);
    assert.equal(rows.length, expected.length);
    for (const [i, old] of expected.entries()) {
      const now = toIssue(db, rows[i] as Record<string, unknown>) as unknown as Record<string, unknown>;
      // fields the old version showed are unchanged; newer fields may be added (0.1.14 had no `external`)
      for (const [k, v] of Object.entries(old)) assert.deepEqual(now[k], v, `${from} issue ${String(old.id)}: ${k}`);
    }
  });
}
