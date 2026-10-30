import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { putItem } from "@packages/settings"

// A job folder's code and the config it reads beside it: its top-level Python, shell and JSON files.
const TAKEN = /\.(?:json|py|sh)$/

// The JSON files a job writes as it runs, which stay in its folder.
const STATE = new Set(["state.json", "watch.json"])

// Pure but for its reads: one job folder as a script item's files, and every other top-level entry by name (state, locks, logs, caches, old copies), which stays in the folder.
export const scriptOf = (
  dir: string,
  job: string,
): { files: Record<string, string>; skipped: string[] } => {
  const files: Record<string, string> = {}
  const skipped: string[] = []
  for (const name of readdirSync(join(dir, job)).sort()) {
    const path = join(dir, job, name)
    if (statSync(path).isFile() && TAKEN.test(name) && !STATE.has(name))
      files[name] = readFileSync(path, "utf8")
    else skipped.push(name)
  }
  return { files, skipped }
}

// playground ext import-scripts, run once at the switch: each job folder named becomes the script <org>/scripts/<job>/, its code and config together, accepted as the owner's own write, each skipped entry printed so the run shows what stays behind.
export const importScripts = async (
  data: string,
  dir: string,
  jobs: string[],
  options: { dryRun: boolean; org: string; reason?: string },
  out: (line: string) => void,
): Promise<number> => {
  const reason = options.reason ?? `imported from ${dir} at the switch`
  let problems = 0
  for (const job of jobs) {
    const { files, skipped } = scriptOf(dir, job)
    if (!Object.keys(files).some((name) => /\.(?:py|sh)$/.test(name))) {
      problems++
      out(`refused ${job}: no .py or .sh file in ${join(dir, job)}`)
      continue
    }
    if (!options.dryRun) {
      const put = putItem(
        data,
        { key: job, kind: "script", scope: options.org },
        { attachments: [], body: null, files, value: null },
        { actor: "cli", author: "owner", inboxRef: null, reason },
        true,
      )
      if (!put.ok && put.status !== 409) {
        problems++
        out(`refused ${job}: ${put.message}`)
        continue
      }
    }
    out(
      `${options.dryRun ? "would add" : "added"} script ${options.org} ${job}: ${Object.keys(files).join(", ")}`,
    )
    if (skipped.length) out(`kept in ${job}: ${skipped.join(", ")}`)
  }
  return problems ? 1 : 0
}
