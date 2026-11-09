import "@packages/env/aliases"
import { rename } from "node:fs/promises"
import { join } from "node:path"

import { envValue } from "@packages/config/org"
import { dataDir } from "@packages/env/data-dir"

// The PRs Ops holds on a lead's word, `owner/name#number` to why, in the data folder (data-dir.ts); PLAYGROUND_HELD_PRS moves it, as the tests do.
export const heldPath = (): string =>
  envValue(process.env, "PLAYGROUND_HELD_PRS") || join(dataDir(), "ops", "report", "held-prs.json")

// A `"*"` line the ship flow wrote lapses this long after it was written, so a ship that stopped without clearing it holds no PR for long; a ship still running past it writes it again. A PR's own line never lapses.
export const FREEZE_LAPSE_MS = 4 * 60 * 60_000

// How a freeze's own `"*"` line ends, after its version: a `"*"` line that ends otherwise is one Ops wrote by hand, which never lapses, even beside a time an earlier freeze left.
const FROZEN = " ships: canary is frozen until its tag lands"

// Pure: the `"*"` line a freeze for version writes, which ship:merge reads back.
export const freezeLine = (version: string): string => `${version}${FROZEN}`

// Pure: whether a `"*"` line is the ship flow's own, the one startFreeze writes.
const frozen = (line: unknown): boolean => typeof line === "string" && line.endsWith(FROZEN)

// How focus's own `"*"` line ends, after its session: it lapses at `until["*"]`, the focus end, and a ship's freeze writes over it.
const FOCUSED = " has focus: every merge waits until focus ends"

// Pure: whether a `"*"` line is focus's own, the one startFocus writes.
const focused = (line: unknown): boolean => typeof line === "string" && line.endsWith(FOCUSED)

// Pure: one key of a file's `since` or `until` map, the time its `"*"` line holds, or NaN.
const timeOf = (map: unknown): number => {
  const at =
    typeof map === "object" && map !== null && !Array.isArray(map)
      ? (map as Record<string, unknown>)["*"]
      : undefined
  return typeof at === "string" ? Date.parse(at) : Number.NaN
}

// Pure: whether the file's `"*"` line has lapsed: a freeze's own, `since["*"]` FREEZE_LAPSE_MS or more ago, or focus's own, at or past `until["*"]`. Any other `"*"` line, or one with no readable time, never lapses.
const lapsed = (
  file: { held?: unknown; since?: unknown; until?: unknown },
  now: number,
): boolean => {
  const line = (file.held as Record<string, unknown> | undefined)?.["*"]
  if (focused(line)) return now >= timeOf(file.until)
  return frozen(line) && now - timeOf(file.since) >= FREEZE_LAPSE_MS
}

// Pure: why this PR is held at `now`, or null when the file is missing or does not list it. A `"*"` key holds every PR, a floor-wide hold such as a ship's, until it lapses, while a PR's own line keeps its own reason. A file that does not read holds every PR, since a hold lost to a typo would let the PR merge. `now` has no default, so no caller mixes a fixed clock with the real one.
export function heldOf(text: string | null, repo: string, n: number, now: number): string | null {
  if (text === null) return null
  let file: { held?: unknown; since?: unknown; until?: unknown } | null
  try {
    file = JSON.parse(text) as { held?: unknown; since?: unknown; until?: unknown } | null
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
export async function readHeld(
  path: string,
  repo: string,
  n: number,
  now: number,
): Promise<string | null> {
  let text: string
  try {
    text = await Bun.file(path).text()
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === "ENOENT") return null
    return `held-prs.json does not read: ${typeof code === "string" ? code : "unreadable"}`
  }
  return heldOf(text, repo, n, now)
}

type HeldFile = {
  held: Record<string, unknown>
  since?: Record<string, unknown>
  until?: Record<string, unknown>
} & Record<string, unknown>

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
  const next = `${path}.${process.pid}.tmp`
  await Bun.write(next, `${JSON.stringify(file, null, 2)}\n`)
  await rename(next, path)
}

// Read only: the `"*"` line, its `since` (a freeze's) and `until` (focus's), each null when unset, and whether it has lapsed at `now`; null when no `"*"` line is set.
export async function freezeStatus(
  path: string,
  now: number,
): Promise<{ lapsed: boolean; line: string; since: string | null; until: string | null } | null> {
  const file = await readFile(path)
  if (!Object.hasOwn(file.held, "*")) return null
  const since = file.since?.["*"]
  const until = file.until?.["*"]
  return {
    lapsed: lapsed(file, now),
    line: String(file.held["*"]),
    since: typeof since === "string" ? since : null,
    until: typeof until === "string" ? until : null,
  }
}

// The ship flow's freeze: the `"*"` line, naming the version, with the time it was written in `since`, keeping every other line, and the line written: running it again restarts the lapse. A `"*"` line Ops wrote by hand holds every PR already, so it stays as it is, and its line is the one given back.
export async function startFreeze(
  path: string,
  version: string,
  now = new Date(),
): Promise<{ kept: boolean; line: string }> {
  const file = await readFile(path)
  const own = file.held["*"]
  if (Object.hasOwn(file.held, "*") && !frozen(own) && !focused(own)) {
    return { kept: true, line: typeof own === "string" && own.trim() ? own : "no reason given" }
  }
  const reason = freezeLine(version)
  const since = typeof file.since === "object" && file.since !== null ? file.since : {}
  await writeFile(path, {
    ...withoutStar(file, "until"),
    held: { ...file.held, "*": reason },
    since: { ...since, "*": now.toISOString() },
  })
  return { kept: false, line: reason }
}

// Pure: the file with its `key` map's `"*"` time gone, and the map too once it is empty.
const withoutStar = (file: HeldFile, key: "since" | "until"): HeldFile => {
  const { [key]: map, ...rest } = file
  const { "*": _star, ...kept } = typeof map === "object" && map !== null ? map : {}
  return Object.keys(kept).length > 0 ? { ...rest, [key]: kept } : (rest as HeldFile)
}

// Focus's hold: a `"*"` line naming the session, lapsing at `until`, and the line written. A ship's freeze or a line Ops wrote by hand holds every PR already, so it stays as it is, and its line is the one given back.
export async function startFocus(
  path: string,
  session: string,
  until: Date,
): Promise<{ kept: boolean; line: string }> {
  const file = await readFile(path)
  const own = file.held["*"]
  if (Object.hasOwn(file.held, "*") && !focused(own)) {
    return { kept: true, line: typeof own === "string" && own.trim() ? own : "no reason given" }
  }
  const reason = `${session}${FOCUSED}`
  const map = typeof file.until === "object" && file.until !== null ? file.until : {}
  await writeFile(path, {
    ...withoutStar(file, "since"),
    held: { ...file.held, "*": reason },
    until: { ...map, "*": until.toISOString() },
  })
  return { kept: false, line: reason }
}

// Focus's end: focus's own `"*"` line and its time go, every other line stays, a ship's freeze and a hand line included. What it found.
export async function endFocus(path: string): Promise<"kept" | "none" | "removed"> {
  if (!(await Bun.file(path).exists())) return "none"
  const file = await readFile(path)
  if (!Object.hasOwn(file.held, "*")) return "none"
  if (!focused(file.held["*"])) return "kept"
  const { "*": _line, ...held } = file.held
  await writeFile(path, { ...withoutStar(file, "until"), held })
  return "removed"
}

// The freeze's end, at the tag or when the ship stops: a freeze's own `"*"` line and its time go, every other line stays, and a `"*"` line Ops wrote by hand is kept for Ops to remove. What it found.
export async function endFreeze(path: string): Promise<"kept" | "none" | "removed"> {
  if (!(await Bun.file(path).exists())) return "none"
  const file = await readFile(path)
  if (!Object.hasOwn(file.held, "*")) return "none"
  if (!frozen(file.held["*"])) return "kept"
  const { "*": _line, ...held } = file.held
  const { "*": _since, ...since } =
    typeof file.since === "object" && file.since !== null ? file.since : {}
  const { since: _all, ...rest } = file
  await writeFile(path, { ...rest, held, ...(Object.keys(since).length > 0 && { since }) })
  return "removed"
}
