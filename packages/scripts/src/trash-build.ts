// scripts/ops/dashboard/supervisor.sh's one delete: bun trash-build.ts <path> <reason> moves one folder directly in the data folder's ops/dashboard/builds to the trash, through the dashboard-supervisor carve-out and as that script's session; any other path or a refusal keeps it and exits 1, sent to the dispatcher but for a plain refusal (a path gone, another volume).
import { dirname, join, resolve } from "node:path"

import { CARVE_OUTS, quarantine, type Roots } from "@packages/safe-delete"

import { rmDeps } from "./playground/rm"
import { machineRoots } from "./trash"

export const SCRIPT = "dashboard-supervisor"

export const trashBuild = (
  path: string,
  reason: string,
  deps: { notify: (text: string) => void; roots: Roots },
): string | null => {
  const builds = join(dirname(deps.roots.trash), CARVE_OUTS[SCRIPT]!.folder)
  // quarantine passes an unprotected path with no carve-out at all, so this check alone keeps the script to its folder
  const moved =
    dirname(resolve(path)) === builds
      ? quarantine(path, { carveOut: SCRIPT, reason, session: SCRIPT }, deps.roots)
      : {
          kind: "protected" as const,
          refused: `${resolve(path)} is not directly in ${builds}, the only folder trash-build takes`,
        }
  if (!("refused" in moved)) return null
  if (moved.kind !== "refused") deps.notify(`${SCRIPT}: ${moved.refused}`)
  return moved.refused
}

if (import.meta.main) {
  const [path, reason] = process.argv.slice(2)
  if (!path || !reason) {
    console.error("usage: bun packages/scripts/src/trash-build.ts <path> <reason>")
    process.exit(2)
  }
  const repo = join(import.meta.dir, "..", "..", "..")
  const why = trashBuild(path, reason, { notify: rmDeps(repo).notify, roots: machineRoots() })
  if (why) console.error(`trash-build: ${why}`)
  process.exit(why ? 1 : 0)
}
