// core-audit's two legs over the tracked tree: a linked org's terms, read at run time from the extensions (leg 1), and values shaped like one org's that need no list (leg 2); each hit names its kind and place, never its text.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { dataDirOf } from "../../../env/src/data-dir"
import { firefightingSettings } from "../../../settings/src/firefighting"
import { scopesIn } from "../../../settings/src/folder"
import { CORE, extensionsDir, loginOf, readPolicySync } from "../../../settings/src/rendered"
import { type File, LEFT_OUT, LOCKFILES, MADE_UP_DATA } from "../trace-count/count"
import {
  EMPTY_LIST,
  isPublicList,
  LIST_KEYS,
  patterns,
  type PublicList,
  UNSET_REPOS,
} from "../trace-count/kinds"

type Environment = Record<string, string | undefined>

export type Hit = { kind: string; leg: 1 | 2; line: number; path: string; where: string }
// A linked org's terms: the run-time list every scope derives for no-public-leak, the tracker keys a hit may write bare (its keys and each org's firefighting prefixes), and the org scopes' own names.
export type Terms = { keys: string[]; list: PublicList; orgs: string[] }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// Each term standing alone, in any case, `_` and `-` counting as separators; a key followed by `-<n>` is the list's own linearKeys hit, so the bare form reads past it.
const bare = (terms: string[], tail = ""): RegExp | undefined =>
  terms.length
    ? new RegExp(`(?<![A-Za-z0-9])(?:${terms.map(escape).join("|")})(?![A-Za-z0-9])${tail}`, "gi")
    : undefined

// The terms of every org scope beside the login's, or none when no org is linked, since core stays core with no org at all.
export function orgTerms(env: Environment): Terms | undefined {
  const data = dataDirOf(env)
  let login = ""
  try {
    login = loginOf(data, env)
  } catch {}
  const orgs = scopesIn(data).filter((scope) => scope !== login && scope !== CORE)
  if (!orgs.length) return undefined
  const path = join(extensionsDir(data), "hooks", "no-public-leak.json")
  let list = EMPTY_LIST
  try {
    const value: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined
    if (isPublicList(value)) list = value
  } catch {}
  const prefixes = orgs.flatMap((org) => {
    const policy = readPolicySync(data, org)
    return policy.settings
      ? firefightingSettings.get(policy.settings, "firefighting.start.prefixes")
      : []
  })
  const keys = [...new Set([...list.linearKeys, ...prefixes].filter(Boolean))]
  return { keys, list, orgs }
}

const counted = (path: string) => ![...LEFT_OUT, ...LOCKFILES].some((re) => re.test(path))
const madeUp = (path: string) => MADE_UP_DATA.some((re) => re.test(path))

// Each line of each counted file that holds a hit of a kind, in file, line and kind order.
function scan(
  files: File[],
  kinds: [string, RegExp, (value: string) => boolean][],
  leg: 1 | 2,
  where: (path: string) => string,
): Hit[] {
  return files.flatMap(({ path, text }) =>
    counted(path)
      ? text
          .split("\n")
          .flatMap((said, i) =>
            kinds
              .filter(([, re, real]) => [...said.matchAll(re)].some(([value]) => real(value)))
              .map(([kind]) => ({ kind, leg, line: i + 1, path, where: where(path) })),
          )
      : [],
  )
}

const always = () => true

// Leg 1: the list kinds as trace-count reads them, each tracker key written bare, and an org's own name; a test's hit takes a made-up value in core, any other the org's extension.
export function leg1(files: File[], terms: Terms): Hit[] {
  const listed = new Set<string>(LIST_KEYS)
  const kinds: [string, RegExp, (value: string) => boolean][] = [
    ...patterns(terms.list, UNSET_REPOS)
      .filter(([kind]) => listed.has(kind))
      .map(([kind, re]): [string, RegExp, typeof always] => [kind, re, always]),
  ]
  const keys = bare(terms.keys, "(?!-\\d)")
  if (keys) kinds.push(["bareKey", keys, always])
  const orgs = bare(terms.orgs)
  if (orgs) kinds.push(["orgName", orgs, always])
  return scan(files, kinds, 1, (path) =>
    madeUp(path) ? "a made-up value in core" : "the org's extension",
  )
}

// A placeholder a doc or a default may write: an id holding EXAMPLE or MADE, a home of one of these generic users.
const PLACEHOLDER_ID = /EXAMPLE|MADE/
const PLACEHOLDER_HOMES = new Set(["me", "owner", "runner", "someone", "x", "you"])

// Leg 2, needing no list: a Slack id or a person's home path written into the tree outside the tests and the fixtures, whose values are made up, belongs in config with a sensible default.
export function leg2(files: File[]): Hit[] {
  return scan(
    files.filter(({ path }) => !madeUp(path)),
    [
      [
        "slackId",
        /(?<![A-Za-z0-9])[CDGUW]0[A-Z0-9]{7,10}(?![A-Za-z0-9])/g,
        (id) => !PLACEHOLDER_ID.test(id),
      ],
      [
        "homePath",
        /\/(?:Users|home)\/[A-Za-z][\w.-]*/g,
        (home) => !PLACEHOLDER_HOMES.has(home.slice(home.indexOf("/", 1) + 1)),
      ],
    ],
    2,
    () => "config with a sensible default",
  )
}

// One hit as the report prints it: its place, leg, kind and where it belongs.
export const line = (hit: Hit): string =>
  `${hit.path}:${hit.line}\tleg ${hit.leg}\t${hit.kind}\t${hit.where}`
