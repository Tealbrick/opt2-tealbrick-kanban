# Provenance of the contract files in this folder

These files are byte copies. Do not edit them. To update, copy the files from a newer spec tag and change this header in
the same commit. `test/access-contract.test.ts` fails when a file no longer matches the sha256 below, or when the manifest
no longer embeds the schemas.

- Source repo: `Tealbrick/opt2-tealbrick-specs` (private)
- Contract: `tb.access/1` (docs/ACCESS.md), spec 0.1.89 (C380). Consumer: Governance (product id `fleet`). Task Board serves `access_list` only.
- Tag `spec-v0.1.89` (commit `074f1a90b77db38176b8a1eae2e7c1159db493c9`, specs#68). First copied from the PR branch at `d543905`; compared with the tag: every file is byte-identical.

| File here | Path in the source repo | sha256 |
|---|---|---|
| `access.list_in.1.schema.json` | `packages/spec/schemas/contracts/access.list_in.1.schema.json` | `83f1c2f7c2c399d8e11a93418e469d01c777af5f6c8bfe7cd2643539f3a04fe5` |
| `access.list_out.1.schema.json` | `packages/spec/schemas/contracts/access.list_out.1.schema.json` | `571feb6b833d392f8eec3212b21d53aa7e529dfb65a34f8a54b89d07160c7f48` |
| `access.list_in.1.json` | `packages/spec/examples/contracts/access.list_in.1.json` | `dc1745d9a0bd6d83fdd672fbc14e119f9637b19537162e77455b246676535c85` |
| `access.list_out.1.json` | `packages/spec/examples/contracts/access.list_out.1.json` | `efc7e1389eb7a7eac55e3149c2ac111959a5664ebaccf630a0155668c70b5c49` |
| `access.digest.1.json` | `packages/spec/examples/contracts/access.digest.1.json` | `e4db19dd894802348b9e87c2251d85383fb2e4f47e90b26dde76c42e17b42daa` |
| `access.caller_vector.1.json` | `packages/spec/examples/contracts/access.caller_vector.1.json` | `faf832b1a3fa7e122f252677e9a946be11668cacd23ce0f765fcaa57ebe5cd49` |

How this app uses them: the manifest embeds the two schemas as the input and output of `access_list` (the SDK validates every
call and answer against them). The fixtures run through the same validator, the digest fixture checks `digestOf`, and the
caller vector checks the guard (`src/access.ts`).
