import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open, readdir, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"

import { dataDir, livePath } from "../sessions/paths"
import { ownFolder } from "./attachments"

// The browser's temporary debug reports, each kept as a file for agents to read, since the owner asks agents to fetch such details themselves: the composer's paste report.
export type DebugReport = "paste"

export const DEBUG_REPORTS_KEPT = 20

const DIR_VARS = {
  paste: ["PLAYGROUND_DEBUG_PASTE_DIR"],
} as const satisfies Record<DebugReport, readonly string[]>

// $PLAYGROUND_DEBUG_<KIND>_DIR when set (a live-reads test stack's scratch folder), else debug/<kind> in the dashboard's data folder; a fixture stack keeps them in its fixture's folder whatever is set.
export const debugReportsDir = (kind: DebugReport): string =>
  resolve(livePath(...DIR_VARS[kind]) || join(dataDir(), "debug", kind))

const NAME = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[\da-f-]{36}\.json$/

// Keeps one report as its own file, 0600 and created with O_EXCL and O_NOFOLLOW in the owner-only folder, named by its time so the newest sort last, then leaves the newest DEBUG_REPORTS_KEPT. Returns the file's name.
export async function storeDebugReport(
  report: object,
  { dir, now = new Date() }: { dir: string; now?: Date },
): Promise<string> {
  const folder = resolve(dir)
  await ownFolder(folder)
  const at = now.toISOString()
  const name = `${at.replace(/[:.]/g, "-")}-${randomUUID()}.json`
  const path = join(folder, name)
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(`${JSON.stringify({ at, ...report }, null, 2)}\n`)
    await file.chmod(0o600)
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error
  } finally {
    await file.close()
  }
  const reports = (await readdir(folder)).filter((n) => NAME.test(n)).sort()
  for (const old of reports.slice(0, -DEBUG_REPORTS_KEPT))
    await unlink(join(folder, old)).catch(() => {})
  return name
}
