// C380: the guarded companion ops (`listing: "workflow"`, no_access for everyone but the listed companion) are not driveable by
// the suite (conformance <= 0.1.30 does not filter `listing`). The harness serves the shipped manifest WITHOUT them; the guard
// has its own unit tests. Remove this file when conformance filters `listing: "workflow"` from agentOps.
import type { AppDefinition } from "@opt2-tealbrick/miniapp-sdk";

type Manifest = AppDefinition["manifest"];
export const GUARDED_OPS: readonly string[] = ["access_list"];

/** tealbrick.manifest.json minus the guarded ops (a copy). */
export function conformanceManifest(m: Manifest): Manifest {
  return { ...m, operations: m.operations.filter((o) => !GUARDED_OPS.includes(o.id)) };
}
