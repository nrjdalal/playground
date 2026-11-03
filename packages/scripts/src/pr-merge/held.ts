import "@packages/env/aliases"
import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"

import { envValue } from "@packages/config/org"
import { dataDir } from "@packages/env/data-dir"

// The PRs Ops holds on a lead's word, `owner/name#number` to why, in the data folder (data-dir.ts); PLAYGROUND_HELD_PRS moves it, as the tests do.
export const heldPath = (): string =>
  envValue(process.env, "PLAYGROUND_HELD_PRS") || join(dataDir(), "ops", "report", "held-prs.json")

// A `"*"` line the ship flow wrote lapses this long after it was written, so a ship that stopped without clearing it holds no PR for long; a ship still running past it writes it again. A PR's own line never lapses.
export const FREEZE_LAPSE_MS = 4 * 60 * 60_000

// Pure: whether the file's `"*"` line has lapsed: `since["*"]`, the time startFreeze wrote it, is FREEZE_LAPSE_MS or more ago. A `"*"` line with no readable time, one Ops wrote by hand, never lapses.
const lapsed = (file: { since?: unknown }, now: number): boolean => {
  const since = file.since
  const at =
    typeof since === "object" && since !== null && !Array.isArray(since)
      ? (since as Record<string, unknown>)["*"]
      : undefined
  const time = typeof at === "string" ? Date.parse(at) : Number.NaN
  return now - time >= FREEZE_LAPSE_MS
}

// Pure: why this PR is held, or null when the file is missing or does not list it. A `"*"` key holds every PR, a floor-wide hold such as a ship's, until it lapses, while a PR's own line keeps its own reason. A file that does not read holds every PR, since a hold lost to a typo would let the PR merge.
export function heldOf(
  text: string | null,
  repo: string,
  n: number,
  now = Date.now(),
): string | null {
  if (text === null) return null
  let file: { held?: unknown; since?: unknown } | null
  try {
    file = JSON.parse(text) as { held?: unknown; since?: unknown } | null
  } catch {
    return "held-prs.json does not read: it is not JSON"
  }
  const held = file?.held
  if (typeof held !== "object" || held === null || Array.isArray(held)) {
    return "held-prs.json does not read: held is not an object"
  }
  const key = [`${repo}#${n}`, "*"].find(
    (name) => Object.hasOwn(held, name) && !(name === "*" && file && lapsed(file, now)),
  )
  if (!key) return null
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

type HeldFile = { held: Record<string, unknown>; since?: Record<string, unknown> } & Record<
  string,
  unknown
>

// The file as it stands, an empty one when it is missing; a file that does not read is never written over, since that would drop Ops' own holds.
async function readFile(path: string): Promise<HeldFile> {
  const file = Bun.file(path)
  if (!(await file.exists())) return { held: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error(`${path} does not read: it is not JSON, so it is left as it is`)
  }
  const held = (parsed as { held?: unknown } | null)?.held
  if (typeof held !== "object" || held === null || Array.isArray(held)) {
    throw new Error(`${path} does not read: held is not an object, so it is left as it is`)
  }
  return parsed as HeldFile
}

// Written whole beside the file, then moved over it, so a reader never sees half a file.
async function writeFile(path: string, file: HeldFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const next = `${path}.${process.pid}.tmp`
  await Bun.write(next, `${JSON.stringify(file, null, 2)}\n`)
  await rename(next, path)
}

// The ship flow's freeze: the `"*"` line, naming the version, with the time it was written in `since`, keeping every other line. Running it again restarts the lapse.
export async function startFreeze(
  path: string,
  version: string,
  now = new Date(),
): Promise<string> {
  const file = await readFile(path)
  const reason = `${version} ships: canary is frozen until its tag lands`
  const since = typeof file.since === "object" && file.since !== null ? file.since : {}
  await writeFile(path, {
    ...file,
    held: { ...file.held, "*": reason },
    since: { ...since, "*": now.toISOString() },
  })
  return reason
}

// The freeze's end, at the tag or when the ship stops: the `"*"` line and its time go, every other line stays. Whether there was one to remove.
export async function endFreeze(path: string): Promise<boolean> {
  if (!(await Bun.file(path).exists())) return false
  const file = await readFile(path)
  const had = Object.hasOwn(file.held, "*")
  const { "*": _line, ...held } = file.held
  const { "*": _since, ...since } =
    typeof file.since === "object" && file.since !== null ? file.since : {}
  const { since: _all, ...rest } = file
  await writeFile(path, { ...rest, held, ...(Object.keys(since).length > 0 && { since }) })
  return had
}
