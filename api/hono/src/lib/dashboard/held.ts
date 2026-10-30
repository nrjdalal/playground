import { join } from "node:path"

import { dataDir } from "@/lib/sessions/paths"

// The pull requests Ops holds on purpose until a set time or a go, each by `owner/name#number` with why: Ops owns the file and its shape, so a missing or unreadable file holds none, and an entry that is not a reason costs only itself.
export const heldPath = (): string => join(dataDir(), "ops", "report", "held-prs.json")

// Pure: the file's text in, each held pull request's reason by `owner/name#number` out.
export function parseHeld(raw: string): Map<string, string> {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return new Map()
  }
  const held =
    typeof json === "object" && json !== null && "held" in json
      ? (json as { held: unknown }).held
      : null
  if (typeof held !== "object" || held === null || Array.isArray(held)) return new Map()
  return new Map(
    Object.entries(held).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
    ),
  )
}

export const readHeld = (): Promise<Map<string, string>> =>
  Bun.file(heldPath())
    .text()
    .then(parseHeld, () => new Map())

const PR_URL_RE = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/

// Pure: why a pull request is held, by its URL, or null when it is not.
export const heldReason = (
  held: ReadonlyMap<string, string>,
  url: string | null,
): string | null => {
  const match = url ? PR_URL_RE.exec(url) : null
  return match ? (held.get(`${match[1]}#${match[2]}`) ?? null) : null
}
