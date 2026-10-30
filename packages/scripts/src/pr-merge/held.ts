import "@packages/env/aliases"
import { join } from "node:path"

import { envValue } from "@packages/config/org"
import { dataDir } from "@packages/env/data-dir"

// The PRs Ops holds on a lead's word, `owner/name#number` to why, in the data folder (data-dir.ts); PLAYGROUND_HELD_PRS moves it, as the tests do.
export const heldPath = (): string =>
  envValue(process.env, "PLAYGROUND_HELD_PRS") || join(dataDir(), "ops", "report", "held-prs.json")

// Pure: why this PR is held, or null when the file is missing or does not list it. A file that does not read holds every PR, since a hold lost to a typo would let the PR merge.
export function heldOf(text: string | null, repo: string, n: number): string | null {
  if (text === null) return null
  let held: unknown
  try {
    held = (JSON.parse(text) as { held?: unknown } | null)?.held
  } catch {
    return "held-prs.json does not read: it is not JSON"
  }
  if (typeof held !== "object" || held === null || Array.isArray(held)) {
    return "held-prs.json does not read: held is not an object"
  }
  const key = `${repo}#${n}`
  if (!Object.hasOwn(held, key)) return null
  const why = (held as Record<string, unknown>)[key]
  return typeof why === "string" && why.trim() ? why.trim() : "no reason given"
}

// A missing file holds none; any other read error (a folder at the path, no permission) holds every PR, as a file that does not parse does.
export async function readHeld(path: string, repo: string, n: number): Promise<string | null> {
  let text: string
  try {
    text = await Bun.file(path).text()
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === "ENOENT") return null
    return `held-prs.json does not read: ${typeof code === "string" ? code : "unreadable"}`
  }
  return heldOf(text, repo, n)
}
