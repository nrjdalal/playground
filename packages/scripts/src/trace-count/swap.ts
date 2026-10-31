// The swap pass at the cut: each list value in the tests, the API's fixtures and the replay fixtures becomes a stand-in made from its position in the list (the nth name the nth made-up name, Slack ids U0MADEUP<nn>, each Linear team a made-up team by its place in A to Z order with the number kept, so keys stay distinct and sort as before, companies acme), so the mapping lives only in memory and no file pairs a real value with its fake.
import type { File } from "./count"
import { LEFT_OUT, LOCKFILES } from "./count"
import { type Kind, patterns, type PublicList, type Repos, UNSET_REPOS } from "./kinds"

export const SCOPE = [
  /^api\/hono\/src\/fixtures\//,
  /^packages\/scripts\/src\/parity\/replay\/fixtures\//,
  /^tests\//,
]
export const inScope = (path: string): boolean =>
  SCOPE.some((re) => re.test(path)) && ![...LEFT_OUT, ...LOCKFILES].some((re) => re.test(path))

const FIRST = [
  "Avery",
  "Blair",
  "Corin",
  "Dorian",
  "Ellis",
  "Farley",
  "Garnet",
  "Hollis",
  "Idris",
  "Jory",
  "Kellan",
  "Lark",
  "Merritt",
  "Niven",
  "Orrin",
  "Perrin",
  "Quinlan",
  "Rowan",
  "Soren",
  "Tamsin",
  "Ulric",
  "Vesper",
  "Wynne",
  "Yorick",
  "Zephyr",
]
const LAST = [
  "Ashdown",
  "Birchall",
  "Coldwell",
  "Dunmore",
  "Elsworth",
  "Fairbrook",
  "Glenholm",
  "Hartwell",
  "Ivesdale",
  "Jessop",
  "Kilbride",
  "Larkspur",
  "Merriwell",
  "Northcote",
  "Oakhurst",
  "Penhallow",
  "Quarrington",
  "Redfern",
  "Stonebridge",
  "Thornbury",
  "Underhill",
  "Vantage",
  "Whitlock",
  "Yardley",
  "Zellwood",
]

// One made-up team per real team, A to Z and none the start of another, so the nth team in A to Z order keeps its place.
const TEAMS = [
  "ACME",
  "BRAVO",
  "CEDAR",
  "DUNE",
  "EMBER",
  "FJORD",
  "GLADE",
  "HAVEN",
  "IRIS",
  "JUNO",
  "KITE",
  "LUMEN",
  "MOSS",
  "NORTH",
  "OPAL",
  "PIKE",
  "QUILL",
  "RIDGE",
  "SAGE",
  "TIDE",
  "UMBER",
  "VALE",
  "WREN",
  "XENO",
  "YARROW",
  "ZINC",
]

const nth = (roster: string[], i: number) =>
  `${roster[i % roster.length]}${i < roster.length ? "" : Math.floor(i / roster.length) + 1}`
const pad = (i: number) => String(i + 1).padStart(2, "0")

// The stand-in for the ith value of each kind; a name of several words takes a made-up surname for each word past the first.
const standIn = (kind: Kind, value: string, i: number): string => {
  if (kind === "names")
    return value
      .split(/\s+/)
      .map((_, word) => nth(word === 0 ? FIRST : LAST, i))
      .join(" ")
  if (kind === "handles") return `octo-${nth(FIRST, i).toLowerCase()}`
  if (kind === "slackIds") return `${value[0]!.toUpperCase()}0MADEUP${pad(i)}`
  if (kind === "linearKeys") return nth(TEAMS, i)
  return "acme"
}

// The stand-in in the found text's case: all lower, all upper, or each word capitalised.
const inCase = (found: string, stand: string): string => {
  if (found === found.toLowerCase()) return stand.toLowerCase()
  if (found === found.toUpperCase() && /[A-Z].*[A-Z]/.test(found)) return stand.toUpperCase()
  return stand.replace(/(^|\s)([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase())
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const byLength = (a: string, b: string) => b.length - a.length
const LIST_KINDS = ["names", "handles", "companies", "slackIds", "linearKeys"] as const

export type Swapper = {
  swap: (text: string) => { counts: Partial<Record<Kind, number>>; text: string }
}

// One pass over a text: each public repository is read past as the count reads it, each Linear key takes its team's stand-in and keeps its number, and every other value takes its stand-in; the longest value wins where two overlap.
export function swapper(list: PublicList, repos: Repos = UNSET_REPOS): Swapper {
  const stands = new Map<string, { kind: Kind; stand: string }>()
  const teams = [...new Set(list.linearKeys.map((key) => key.toLowerCase()))].sort()
  for (const kind of LIST_KINDS)
    list[kind].forEach((value, i) => {
      const team = kind === "linearKeys"
      const key = `${team ? "key:" : ""}${value.toLowerCase()}`
      const at = team ? teams.indexOf(value.toLowerCase()) : i
      if (!stands.has(key)) stands.set(key, { kind, stand: standIn(kind, value, at) })
    })
  const leaked = patterns(list, repos)
    .filter(([kind]) => (LIST_KINDS as readonly string[]).includes(kind))
    .filter(([, re]) => [...stands.values()].some(({ stand }) => new RegExp(re).test(`${stand}-1`)))
  if (leaked.length)
    throw new Error(`a stand-in matches the list's ${leaked.map(([kind]) => kind).join(", ")}`)

  const keys = [...list.linearKeys].sort(byLength).map(escape)
  const values = LIST_KINDS.filter((kind) => kind !== "linearKeys")
    .flatMap((kind) => list[kind])
    .sort(byLength)
    .map(escape)
  const alternatives = [
    `(${[...repos.public].sort(byLength).map(escape).join("|")})`,
    keys.length ? `(?<![a-z\\d])(${keys.join("|")})-(?=\\d+(?![a-z\\d]))` : "(?!)",
    values.length ? `(?<![a-z\\d])(${values.join("|")})(?![a-z\\d])` : "(?!)",
  ]
  const re = new RegExp(alternatives.join("|"), "gi")
  return {
    swap(text) {
      const counts: Partial<Record<Kind, number>> = {}
      const swapped = text.replace(re, (found, repo, key, value) => {
        if (repo) return found
        const { kind, stand } = stands.get(key ? `key:${key.toLowerCase()}` : value.toLowerCase())!
        counts[kind] = (counts[kind] ?? 0) + 1
        return key ? `${inCase(key, stand)}-` : inCase(value, stand)
      })
      return { counts, text: swapped }
    },
  }
}

// Each in-scope file the pass would change, with its hits per kind and its new text.
export const swapTree = (files: File[], list: PublicList, repos: Repos = UNSET_REPOS) => {
  const { swap } = swapper(list, repos)
  return files.flatMap(({ path, text }) => {
    if (!inScope(path)) return []
    const swapped = swap(text)
    return swapped.text === text ? [] : [{ counts: swapped.counts, path, text: swapped.text }]
  })
}
