// The rename's rules, as pure functions over a file's text and path, so a second run changes nothing: `env` takes `DESK_*` and `LIGHTMAN_*` env names to `PLAYGROUND_*`, `product` takes LightMan to Playground and the identifiers that name the product to playground, `routes` moves the dashboard's routes under /api/v1, and `word` takes "desk" to "dashboard" in every case form.

import { DESK_ENV } from "@packages/env/aliases"

export const RULES = ["env", "product", "routes", "word"] as const
export type Rule = (typeof RULES)[number]
const ALL = new Set<Rule>(RULES)

// Paths whose word-rule target already exists, each with the path it takes instead; a reference to the old path (with or without its extension) moves with it.
export const COLLISIONS: Record<string, string> = {
  "tests/web/next/src/components/desk/sidebar.test.ts":
    "tests/web/next/src/components/dashboard/app-sidebar.test.ts",
  "web/next/src/components/desk/sidebar.tsx": "web/next/src/components/dashboard/app-sidebar.tsx",
}

// Files the rename leaves as they are: history, generated lockfiles and migrations, vendored skills, the leak hook's term list, and the env aliases, the old routes' mounts, the rename's own rules and their tests and the UI copy test, which hold the old names as data.
export const EXCLUDED = [
  /^CHANGELOG\.md$/,
  /^\.github\/notes\//,
  /^\.agents\/skills\/(agent-browser|portless)\//,
  /^skills\/zerostarter\/(agent-browser|portless)\//,
  /^bun\.lock$/,
  /^package-lock\.json$/,
  /^packages\/db\/drizzle\//,
  /^packages\/env\/src\/aliases\.ts$/,
  /^api\/hono\/src\/routers\/old-paths\.ts$/,
  /^packages\/scripts\/src\/rename\//,
  /^extensions\/core\/lists\/playground-terms\.json$/,
  /^tests\/api\/hono\/src\/routers\/old-paths\.test\.ts$/,
  /^tests\/packages\/env\/src\/aliases\.test\.ts$/,
  /^tests\/packages\/scripts\/src\/rename\//,
  /^tests\/web\/next\/src\/ui-copy\.test\.ts$/,
]

// Edits a pattern cannot place by its text alone, by path: a package's name, where the same JSON key elsewhere holds a session's name.
export const FILE_EDITS: Record<string, [string, string][]> = {
  "package.json": [['"name": "lightman"', '"name": "playground"']],
  "web/next/package.json": [['"name": "lightman"', '"name": "playground"']],
}

export const isExcluded = (path: string): boolean => EXCLUDED.some((re) => re.test(path))

const WORD: Record<string, string> = {
  DESK: "DASHBOARD",
  DESKS: "DASHBOARDS",
  Desk: "Dashboard",
  Desks: "Dashboards",
  desk: "dashboard",
  desks: "dashboards",
}

// The lightman command's verbs, so `lightman page` is the command and a bare "lightman" (a session's name, the repo) stays.
const VERBS = "add|alerts-wait|page|picker|start|status|sweep|update|view|--help"

// A word's start is any place not after a letter or digit, an escape's letter (the n of a \\n) counting as no letter. A pattern names its rule, so a run can take some rules alone; `keep` holds an old token on a line that already holds the word it sits in as it becomes, the line's fallback for the old name (an env read, a matcher for old posts). An earlier pattern wins where two could match at one place, and no pattern holds a capture group.
type Pattern = { keep?: true; re: string; rule: Rule; to: (token: string) => string }

const DESK_ENV_NAMES = [...DESK_ENV].sort((a, b) => b.length - a.length).join("|")

const PATTERNS: Pattern[] = [
  {
    keep: true,
    re: String.raw`(?<!(?<!\\)[A-Za-z0-9_])(?:LIGHTMAN_[A-Z0-9_]+|DESK_(?:${DESK_ENV_NAMES})(?![A-Z0-9_]))`,
    rule: "env",
    to: (token) => token.replace(/^(DESK|LIGHTMAN)_/, "PLAYGROUND_"),
  },
  {
    keep: true,
    re: String.raw`LightMans?(?![a-z])`,
    rule: "product",
    to: (token) => token.replace("LightMan", "Playground"),
  },
  {
    keep: true,
    re: [
      String.raw`(?<!(?<!\\)[A-Za-z0-9_-])\.?claude/lightman(?![A-Za-z0-9_-])`,
      String.raw`"\.claude", "lightman"`,
      String.raw`'\.claude', 'lightman'`,
    ].join("|"),
    rule: "product",
    // the old data folder in Claude's config folder becomes .playground in the home folder
    to: (token) =>
      token.startsWith("claude/")
        ? token.replace("lightman", "playground")
        : token.replace(/\.claude(?:\/|["'], ["'])lightman/, ".playground"),
  },
  {
    keep: true,
    re: [
      String.raw`(?<!(?<!\\)[A-Za-z0-9_-])lightman(?=(?:-[A-Za-z0-9_<>{}$.-]*?)?-(?:db|redis)(?![A-Za-z0-9_-]))`,
      String.raw`(?<!(?<!\\)[A-Za-z0-9_-])lightman(?=\.localhost|-factory(?![A-Za-z0-9_-]))`,
      String.raw`(?<=no-)lightman(?=-leak)`,
      String.raw`(?<=com\.)lightman(?=\.)`,
      String.raw`(?<=portless get (?:api\.)?)lightman(?![A-Za-z0-9_.-])`,
      String.raw`(?<=(?:src|bin|\.\.?)/)lightman(?=[/"']|$)`,
      String.raw`(?<!(?<!\\)[A-Za-z0-9_./-])lightman(?= (?:${VERBS})(?![A-Za-z0-9_-]))`,
    ].join("|"),
    rule: "product",
    to: () => "playground",
  },
  {
    re: [String.raw`(?<=/api)/desk(?![A-Za-z0-9_-])`, String.raw`(?<=apiClient)\.desk(?=\.)`].join(
      "|",
    ),
    rule: "routes",
    to: (token) => token.replace("desk", "v1"),
  },
  {
    re: [
      String.raw`(?<=/api)/(?:apps|inbox|sessions)(?![A-Za-z0-9_-])`,
      String.raw`(?<=apiClient)\.(?:apps|inbox|sessions)(?=[.[)])`,
    ].join("|"),
    rule: "routes",
    to: (token) => `${token[0]}v1${token}`,
  },
  {
    re: String.raw`(?<!(?<!\\)[A-Za-z0-9_])DESK_[A-Z0-9_]+|(?<!(?<!\\)[A-Z])DESKS?(?![A-Z]|_\*)|(?<!(?<!\\)[A-Za-z])desks?(?![a-z])|Desks?(?![a-z])`,
    rule: "word",
    to: (token) =>
      token.startsWith("DESK_")
        ? `DASHBOARD_${token.slice("DESK_".length)}`
        : (WORD[token] ?? token),
  },
]

const TOKEN = new RegExp(PATTERNS.map((p) => `(${p.re})`).join("|"), "g")

// Names a running machine already holds, which the code looks up rather than makes, so they keep their old spelling until the switch's migration moves them: the live dashboard's database container and the branch and worktree its checkout is on, which live.container and live.branch name on that machine.
export const LIVE_NAMES = [
  String.raw`(?<!(?<!\\)[A-Za-z0-9_])(?:lightman-desk-db|live\/desk)(?![A-Za-z0-9_-])`,
  String.raw`worktrees\/desk(?![A-Za-z0-9_-])`,
  String.raw`(?<=(?:worktrees|["']canary)["']?,\s*)["']desk["']`,
  String.raw`desk(?=\.(?:api\.)?(?:lightman|playground)\.localhost)`,
  String.raw`(?<=\`)desk(?=\.\`)`,
]
// Each old session name a machine past the switch still answers to, with the role it names: the one home of the old names, which the tests read through tests/old-names.ts.
export const OLD_ROLES = {
  lightboy: "ops",
  lightkid: "builder",
  lightman: "dispatcher",
  lightplan: "planner",
} as const

// Paths in the tree from before the rename, which playground migrate reads at that commit, so they keep that tree's spelling.
export const OLD_TREE_PATHS = {
  endOfDayScan: "skills/engineering/lightday-scan/SKILL.md",
} as const

// A live name keeps in a regex literal too, its / and . escaped (/live\/desk/).
const LIVE = new RegExp(
  `(${LIVE_NAMES.map((re) => re.replaceAll("\\/", "\\\\?\\/").replaceAll("\\.", "\\\\?\\.")).join("|")})`,
)

// The rest of the word a token sits in, so `keep` asks whether the line holds the whole renamed word (com.playground.ops-awake), not just its new part.
const WORD_TAIL = /[A-Za-z0-9_.\/-]*$/
const WORD_HEAD = /^[A-Za-z0-9_.\/-]*/

// One pass over a line, so no rule sees another's output; a live name's text is left as it is.
const renameLine = (line: string, rules: Set<Rule>): string =>
  line
    .split(LIVE)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(TOKEN, (token: string, ...rest: unknown[]) => {
            const pattern = PATTERNS[rest.findIndex((group) => group !== undefined)]
            if (!rules.has(pattern.rule)) return token
            const target = pattern.to(token)
            if (!pattern.keep) return target
            const at = rest[PATTERNS.length] as number
            const before = WORD_TAIL.exec(part.slice(0, at))![0]
            const after = WORD_HEAD.exec(part.slice(at + token.length))![0]
            return line.includes(before + target + after) ? token : target
          }),
    )
    .join("")

const COLLISION_REFS = Object.entries(COLLISIONS).map(
  ([from, to]) => [from.replace(/\.[a-z]+$/, ""), to.replace(/\.[a-z]+$/, "")] as const,
)
const tail = (path: string) => path.replace(/^(tests\/)?web\/next\/src\//, "")

// A reference to a collision path, by its repo path or the tail an import names (`components/desk/sidebar`), moves to its mapped path before the word rule could send it to the colliding file.
const renameCollisionRefs = (text: string): string => {
  let out = text
  for (const [from, to] of COLLISION_REFS)
    for (const [a, b] of [
      [from, to],
      [tail(from), tail(to)],
    ])
      out = out.replace(
        new RegExp(`${a.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9_-])`, "g"),
        b,
      )
  return out
}

export const renameText = (text: string, rules: Set<Rule> = ALL): string =>
  (rules.has("word") ? renameCollisionRefs(text) : text)
    .split("\n")
    .map((line) => renameLine(line, rules))
    .join("\n")

export const renamePath = (path: string, rules: Set<Rule> = ALL): string =>
  (rules.has("word") ? COLLISIONS[path] : undefined) ?? renameLine(path, rules)

export type Plan = {
  collisions: string[]
  edits: { path: string; text: string }[]
  moves: { from: string; to: string }[]
}

// What a run does to the tree given: every move and edit, and every move whose target another tracked path already holds, which refuses the run.
export const plan = (
  files: { path: string; text: string | null }[],
  rules: Set<Rule> = ALL,
): Plan => {
  const tracked = new Set(files.map((f) => f.path))
  const moves: Plan["moves"] = []
  const edits: Plan["edits"] = []
  const collisions: string[] = []
  for (const { path, text } of files) {
    if (isExcluded(path)) continue
    const to = renamePath(path, rules)
    if (to !== path) {
      if (tracked.has(to)) collisions.push(`${path} -> ${to}`)
      moves.push({ from: path, to })
    }
    if (text !== null) {
      let next = renameText(text, rules)
      if (rules.has("product"))
        for (const [from, to] of FILE_EDITS[path] ?? []) next = next.replaceAll(from, to)
      if (next !== text) edits.push({ path, text: next })
    }
  }
  return { collisions, edits, moves }
}
