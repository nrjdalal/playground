import { existsSync } from "node:fs"
import { join } from "node:path"

// Old copies of scripts the repo now runs from scripts/ops/, left in the data folder's ops/ by the hand-kept setup: the Dashboard's job scripts in ops/dashboard/ (also the live Dashboard's state folder, so only these files go) and once.py. The switch's migrate copies each into the archive folder, then deletes it.
export const STALE_OPS_COPIES = [
  "ops/dashboard/alert-summary.py",
  "ops/dashboard/procs.sh",
  "ops/dashboard/redeploy-pull.sh",
  "ops/dashboard/run.sh",
  "ops/dashboard/start-ingest.sh",
  "ops/dashboard/supervisor.sh",
  "ops/dashboard/watch-stuck.py",
  "ops/once.py",
] as const

// The stale copies a data folder still holds, as absolute paths.
export const staleCopies = (data: string): string[] =>
  STALE_OPS_COPIES.map((path) => join(data, path)).filter((path) => existsSync(path))
