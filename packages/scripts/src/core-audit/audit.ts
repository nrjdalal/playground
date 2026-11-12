// core-audit's two legs over the tracked tree: a linked org's terms, read at run time from the extensions (leg 1), and values shaped like one org's that need no list (leg 2); each hit names its kind and place, never its text.
import { join } from "node:path"

import { dataDirOf } from "../../../env/src/data-dir"
import { extSettings } from "../../../settings/src/ext"
import { scopesIn } from "../../../settings/src/folder"
import { CORE, extensionsDir, loginOf, readPolicySync } from "../../../settings/src/rendered"
import {
  type File,
  LEFT_OUT,
  list as readList,
  LOCKFILES,
  MADE_UP_DATA,
  readable,
} from "../trace-count/count"
import {
  anyOf,
  LIST_KEYS,
  patterns,
  type PublicList,
  type Repos,
  reposOf,
} from "../trace-count/kinds"

type Environment = Record<string, string | undefined>

export type Hit = { kind: string; leg: 1 | 2; line: number; path: string; where: string }
// A linked org's terms: the run-time list every scope derives for no-public-leak, the tracker keys a hit may write bare (the list's own), the org scopes' own names, the GitHub orgs and repositories ext.links and ext.repos give them, and the public repositories trace-count reads past.
export type Terms = {
  github: string[]
  keys: string[]
  list: PublicList
  orgs: string[]
  repos: Repos
}

// The terms of every org scope beside the login's, none when no org is linked, since core stays core with no org at all, or trace-count's refusal when the list or the policy cannot be read, since an empty list would print a false all-clear.
export async function orgTerms(env: Environment): Promise<Terms | { refusal: string } | undefined> {
  const data = dataDirOf(env)
  const scopes = scopesIn(data).filter((scope) => scope !== CORE)
  if (!scopes.length) return undefined
  let login: string
  try {
    login = loginOf(data, env)
  } catch (error) {
    return { refusal: (error as Error).message }
  }
  const orgs = scopes.filter((scope) => scope !== login)
  if (!orgs.length) return undefined
  const read = await readList(join(extensionsDir(data), "hooks", "no-public-leak.json"))
  if ("refusal" in read) return read
  const base = readPolicySync(data)
  if (!base.settings) return { refusal: base.refusal }
  const links = extSettings.get(base.settings, "ext.links")
  const repos = extSettings.get(base.settings, "ext.repos")
  const named = new Set(orgs.map((org) => org.toLowerCase()))
  const github = [
    ...new Set(orgs.flatMap((org) => [...(links[org] ?? []), ...(repos[org] ? [repos[org]] : [])])),
  ].filter((term) => term !== "*" && !named.has(term.toLowerCase()))
  const keys = [...new Set(read.list.linearKeys.filter(Boolean))]
  return { github, keys, list: read.list, orgs, repos: reposOf(base.settings) }
}

const counted = (path: string) => ![...LEFT_OUT, ...LOCKFILES].some((re) => re.test(path))
const madeUp = (path: string) => MADE_UP_DATA.some((re) => re.test(path))

// A kind: its name, its pattern, and whether a match is real.
type Kind = [string, RegExp, (value: string) => boolean]

// Each line of each counted file that holds a hit of a kind, in file, line and kind order, each line read as read gives it.
function scan(
  files: File[],
  kinds: Kind[],
  leg: 1 | 2,
  where: (path: string, kind: string) => string,
  read: (line: string) => string = (line) => line,
): Hit[] {
  return files.flatMap(({ path, text }) =>
    counted(path)
      ? text
          .split("\n")
          .map(read)
          .flatMap((said, i) =>
            kinds
              .filter(([, re, real]) => [...said.matchAll(re)].some(([value]) => real(value)))
              .map(([kind]) => ({ kind, leg, line: i + 1, path, where: where(path, kind) })),
          )
      : [],
  )
}

const always = () => true

// Leg 1: the list kinds as trace-count reads them, each tracker key written bare, an org's own name and its GitHub orgs and repositories; a test's hit takes a made-up value in core, any other the org's extension.
export function leg1(files: File[], terms: Terms): Hit[] {
  const listed = new Set<string>(LIST_KEYS)
  const kinds: Kind[] = patterns(terms.list, terms.repos)
    .filter(([kind]) => listed.has(kind))
    .map(([kind, re]): [string, RegExp, typeof always] => [kind, re, always])
  const keys = anyOf(terms.keys, "(?!-\\d)")
  if (keys) kinds.push(["bareKey", keys, always])
  const orgs = anyOf(terms.orgs)
  if (orgs) kinds.push(["orgName", orgs, always])
  const github = anyOf(terms.github)
  if (github) kinds.push(["githubName", github, always])
  return scan(
    files,
    kinds,
    1,
    (path) => (madeUp(path) ? "a made-up value in core" : "the org's extension"),
    (line) => readable(line, terms.repos),
  )
}

// A placeholder a doc, a default or a test may write: an id holding EXAMPLE or MADE, a home of one of these generic users, a tracker key's team holding MADE, of the factory's own (PG), a made-up one or a standard's name (UTF-8, SHA-256, ISO-8601, PDF-1.7); a team a real org could hold stays off it.
const PLACEHOLDER_ID = /EXAMPLE|MADE/
const PLACEHOLDER_HOMES = new Set(["me", "owner", "runner", "someone", "x", "you"])
const PLACEHOLDER_KEYS = new Set(["AB", "ABC", "ACME", "FIX", "ISO", "PDF", "PG", "SHA", "UTF"])

// Leg 2, needing no list: a Slack id or a person's home path written into the tree belongs in config with a sensible default, or in a test or a fixture a placeholder, and a tracker key anywhere takes a placeholder.
export function leg2(files: File[]): Hit[] {
  return scan(
    files,
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
      [
        "trackerKey",
        /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9]{1,9}-\d+(?![A-Za-z0-9])/g,
        (key) => {
          const team = key.slice(0, key.indexOf("-"))
          return !PLACEHOLDER_KEYS.has(team) && !team.includes("MADE")
        },
      ],
    ],
    2,
    (path, kind) =>
      kind === "trackerKey"
        ? "a placeholder key such as PG-1"
        : madeUp(path)
          ? "a placeholder id or home"
          : "config with a sensible default",
  )
}

// One hit as the report prints it: its place, leg, kind and where it belongs.
export const line = (hit: Hit): string =>
  `${hit.path}:${hit.line}\tleg ${hit.leg}\t${hit.kind}\t${hit.where}`
