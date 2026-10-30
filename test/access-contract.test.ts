// C380 B6 contract proof (tb.access/1 as frozen in spec 0.1.89, docs/ACCESS.md): the vendored schemas and fixtures are byte copies
// (test/contracts/PROVENANCE.md), the manifest embeds the schemas, the fixtures read as the schemas say, and the guard passes the
// shared caller vector.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, validateAgainstSchema } from "@opt2-tealbrick/manifest";
import { digestOf, guardCaller } from "../src/access.ts";
import { manifest } from "../src/app.ts";

const read = (f: string) => readFileSync(new URL(`./contracts/${f}`, import.meta.url));
const json = (f: string) => JSON.parse(read(f).toString("utf8"));
const sha = (f: string) => createHash("sha256").update(read(f)).digest("hex");

const SHA: Record<string, string> = {
  "access.list_in.1.schema.json": "83f1c2f7c2c399d8e11a93418e469d01c777af5f6c8bfe7cd2643539f3a04fe5",
  "access.list_out.1.schema.json": "571feb6b833d392f8eec3212b21d53aa7e529dfb65a34f8a54b89d07160c7f48",
  "access.caller_vector.1.json": "faf832b1a3fa7e122f252677e9a946be11668cacd23ce0f765fcaa57ebe5cd49",
  "access.digest.1.json": "e4db19dd894802348b9e87c2251d85383fb2e4f47e90b26dde76c42e17b42daa",
  "access.list_in.1.json": "dc1745d9a0bd6d83fdd672fbc14e119f9637b19537162e77455b246676535c85",
  "access.list_out.1.json": "efc7e1389eb7a7eac55e3149c2ac111959a5664ebaccf630a0155668c70b5c49",
};

test("contract: the vendored files are byte copies (sha256 as in PROVENANCE.md)", () => {
  for (const [file, want] of Object.entries(SHA)) assert.equal(sha(file), want, file);
});

test("contract: the manifest embeds the spec schemas as the op input and output, byte for byte after JCS", () => {
  const op = manifest.operations.find((o) => o.id === "access_list");
  assert.equal(canonicalize(op?.input as never), canonicalize(json("access.list_in.1.schema.json")));
  assert.equal(canonicalize(op?.output as never), canonicalize(json("access.list_out.1.schema.json")));
});

test("contract: every valid fixture passes its schema and every invalid one is refused", () => {
  for (const [name, schema] of [["access.list_in.1.json", "access.list_in.1.schema.json"], ["access.list_out.1.json", "access.list_out.1.schema.json"]] as const) {
    const fixtures = json(name) as { valid: unknown[]; invalid: { why: string; doc: unknown }[] };
    assert.ok(fixtures.valid.length > 0 && fixtures.invalid.length > 0);
    for (const doc of fixtures.valid) assert.equal(validateAgainstSchema(json(schema), doc as never).ok, true, `${name} valid: ${JSON.stringify(doc).slice(0, 80)}`);
    for (const { why, doc } of fixtures.invalid) assert.equal(validateAgainstSchema(json(schema), doc as never).ok, false, `${name} invalid: ${why}`);
  }
});

test("contract: the digest fixture (JCS of v, target, id, kind, subject, resource, level; state, label, since, revocable, direction are out)", () => {
  const fx = json("access.digest.1.json") as { target: string; jcs: string; digest: string; equal: { item: Parameters<typeof digestOf>[0] & { digest: string } }[]; different: { item: Parameters<typeof digestOf>[0] & { digest: string } }[] };
  assert.equal(`sha256:${createHash("sha256").update(fx.jcs).digest("hex")}`, fx.digest);
  for (const { item } of fx.equal) assert.equal(digestOf(item, fx.target), fx.digest);
  for (const { item } of fx.different) {
    assert.equal(digestOf(item, fx.target), item.digest);
    assert.notEqual(item.digest, fx.digest);
  }
});

test("contract: the guard passes the shared 6-case caller vector with the exact code and status", () => {
  const vector = json("access.caller_vector.1.json") as { cases: { name: string; caller: Record<string, unknown>; allow: boolean; code?: string; status?: number }[] };
  assert.equal(vector.cases.length, 6);
  for (const c of vector.cases) {
    const run = () => guardCaller({ caller: c.caller as never });
    if (c.allow) assert.doesNotThrow(run, c.name);
    else assert.throws(run, (e: { code?: string; httpStatus?: number }) => e.code === c.code && e.httpStatus === c.status, c.name);
  }
});
