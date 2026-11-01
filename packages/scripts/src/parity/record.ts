import { ts } from "ts-morph"

import { renamePath } from "../rename/rules"

// The parity recording: per session kind, the hooks it registers, the rule ids it loads and the values it runs with, plus every test file's case count, as sorted tab-separated lines over a tree's text, so two trees compare line by line.

type Kind = { docs: string[]; settings: string[]; values: string[] }

const SKILL = "playbook/SKILL.md"

// The factory's standing rules: each is its own file under core's rules/ or an extension's rules/, whose glance the SessionStart rules hook renders, and SKILL.md points at them with no glance of its own.
const FACTORY = [SKILL, "core/rules/"]

// Where each factory input lived before core took it, read when a tree lacks it, so a tree from before the move records the same ids.
export const FORMER: Record<string, string> = {
  "core/rules/": "playground-factory/rules/",
  [SKILL]: "playground-factory/SKILL.md",
}
const REPO_SETTINGS = ["scripts/factory-settings.json", ".claude/settings.json"]

// What each kind reads at its start: a kind in the repo's folder gets the repo's settings beside spawn.sh's built ones, and a worker in another repo the built ones alone.
export const KINDS: Record<string, Kind> = {
  dispatcher: {
    docs: ["AGENTS.md", ...FACTORY],
    settings: REPO_SETTINGS,
    values: ["scripts/spawn.sh"],
  },
  lead: { docs: ["AGENTS.md", ...FACTORY], settings: REPO_SETTINGS, values: ["scripts/spawn.sh"] },
  "outside-worker": {
    docs: [...FACTORY, "briefs/new-worker.md"],
    settings: ["scripts/factory-settings.json"],
    values: ["scripts/spawn.sh"],
  },
  "repo-worker": {
    docs: ["AGENTS.md", ...FACTORY, "briefs/new-worker.md"],
    settings: REPO_SETTINGS,
    values: ["scripts/spawn.sh"],
  },
  reviewer: {
    docs: ["AGENTS.md", ...FACTORY, "briefs/new-reviewer.md"],
    settings: REPO_SETTINGS,
    values: ["scripts/spawn.sh"],
  },
}

export const isTestFile = (path: string): boolean =>
  /^tests\/.*\.test\.tsx?$/.test(path) || /^tests\/(.*\/)?test_[^/]*\.py$/.test(path)

// An input by its exact path, else the one path ending in it, so a later move of its folder still finds it.
const resolve = (files: Map<string, string>, ref: string): string | undefined => {
  if (files.has(ref)) return ref
  const tails = [...files.keys()].filter((path) => path.endsWith(`/${ref}`))
  return tails.length === 1 ? tails[0] : undefined
}

const label = (ref: string): string =>
  ref
    .split("/")
    .slice(-2)
    .join("/")
    .replace(/^scripts\//, "")

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node

// A bun test file's cases by a TypeScript parse: each outermost `test(` or `it(` call with a name and a body, an `.each` table by its rows (a literal, or a const array the file names), a skip or a todo as none, since neither runs.
const countTs = (path: string, text: string): number => {
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const arrays = new Map<string, number>()
  let count = 0
  const rows = (arg: ts.Expression | undefined): number => {
    const node = arg && unwrap(arg)
    if (node && ts.isArrayLiteralExpression(node)) return node.elements.length
    if (node && ts.isIdentifier(node)) return arrays.get(node.text) ?? 1
    return 1
  }
  const cases = (call: ts.CallExpression): number => {
    if (call.arguments.length < 2) return 0
    const modifiers: string[] = []
    let table: ts.Expression | undefined
    let node: ts.Expression = call.expression
    for (;;) {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "each")
          table = node.arguments[0]
        node = node.expression
      } else if (ts.isPropertyAccessExpression(node)) {
        modifiers.push(node.name.text)
        node = node.expression
      } else break
    }
    if (!ts.isIdentifier(node) || !["it", "test"].includes(node.text)) return 0
    if (modifiers.some((m) => m === "skip" || m === "todo")) return 0
    return modifiers.includes("each") ? rows(table) : 1
  }
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer)
      if (ts.isArrayLiteralExpression(init)) arrays.set(node.name.text, init.elements.length)
    }
    const parent = node.parent
    if (
      ts.isCallExpression(node) &&
      !(
        (ts.isCallExpression(parent) || ts.isPropertyAccessExpression(parent)) &&
        parent.expression === node
      )
    )
      count += cases(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return count
}

// A Python test file's cases by its lines: each `def test_` and `check(` call, or, for a file with neither, each public top-level function; a row of a Python case table is not counted, as these files wait for their TypeScript port (tests/python-allowlist.test.ts).
const countPy = (text: string): number => {
  const lines = text.split("\n")
  const marked = lines.filter((line) => /^\s*(def test_\w+|check)\(/.test(line))
  return marked.length || lines.filter((line) => /^def [a-z]\w*\(/.test(line)).length
}

export const countTests = (path: string, text: string): number =>
  path.endsWith(".py") ? countPy(text) : countTs(path, text)

type Handler = { command: string; timeout?: number }
type Settings = { hooks?: Record<string, { hooks: Handler[]; matcher?: string }[]> }

const flatten = (value: unknown, key: string, out: string[]) => {
  if (Array.isArray(value)) for (const item of value) flatten(item, `${key}[]`, out)
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) flatten(v, key ? `${key}.${k}` : k, out)
  else out.push(`${key}=${JSON.stringify(value)}`)
}

// A handler two settings files both register runs once, as Claude Code dedupes it, so the merge keys on its event, matcher and command.
const hooks = (parsed: Settings[]): string[] => {
  const seen = new Map<string, string>()
  for (const settings of parsed)
    for (const [event, groups] of Object.entries(settings.hooks ?? {}))
      for (const group of groups)
        for (const handler of group.hooks) {
          const script =
            handler.command.match(/scripts\/hooks\/([\w.-]+)\.\w+/)?.[1] ?? handler.command
          seen.set(
            [event, group.matcher, handler.command].join("\0"),
            `${event} ${group.matcher ?? "*"} ${script} timeout=${handler.timeout ?? "default"}`,
          )
        }
  return [...seen.values()]
}

// A doc's rule ids, outside its code fences: each `- **name**` bullet, each ALWAYS or NEVER rule by its first five words (as tests/AGENTS.test.ts pins them), each heading.
const ruleIds = (text: string): string[] => {
  const ids: string[] = []
  let fenced = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    if (fenced) continue
    const bullet = line.match(/^- \*\*([^*[\]]+)\*\*/)?.[1]
    const always = line.match(/^- (ALWAYS|NEVER): (.*)/)
    const heading = line.match(/^#{1,6} (.+)/)?.[1]
    if (bullet) ids.push(bullet)
    if (always) ids.push(`${always[1]}: ${always[2]!.split(" ").slice(0, 5).join(" ")}`)
    if (heading) ids.push(`§ ${heading.trim()}`)
  }
  return ids
}

// A standing rule's id, the same whether the glance names it or its own file holds it, so its move to rules/ keeps the id.
const standing = (name: string): string => `playbook#${name}`

// A doc's frontmatter, less its description, whose wording is no value.
const frontmatter = (text: string): string[] => {
  if (!text.startsWith("---\n")) return []
  const end = text.indexOf("\n---", 4)
  return text
    .slice(4, end < 0 ? 4 : end)
    .split("\n")
    .filter((line) => line && !line.startsWith("description:"))
}

// A launch file's values: each top-level constant it sets, and each headless claude launch outside a comment.
const launchValues = (text: string): string[] =>
  text
    .split("\n")
    .filter(
      (line) =>
        /^[A-Z_][A-Z0-9_]* ?=/.test(line) || (/\bclaude -p\b/.test(line) && !/^\s*#/.test(line)),
    )

export const record = (files: Map<string, string>): string[] => {
  const lines = new Set<string>()
  for (const [kind, inputs] of Object.entries(KINDS)) {
    // each input as the rename leaves it, since both trees are read that way (tree.ts)
    const [docs, settings, values] = [inputs.docs, inputs.settings, inputs.values].map((refs) =>
      refs.map((ref) => renamePath(ref)),
    )
    const add = (section: string, item: string) => lines.add(`${kind}\t${section}\t${item}`)
    const read = (ref: string): string | undefined => {
      const path = resolve(files, ref) ?? (FORMER[ref] && resolve(files, FORMER[ref]))
      if (path === undefined) add("missing", ref)
      return path === undefined ? undefined : files.get(path)
    }
    const parsed: Settings[] = []
    for (const ref of settings) {
      const text = read(ref)
      if (text === undefined) continue
      const json = JSON.parse(text) as Settings & Record<string, unknown>
      parsed.push(json)
      const { hooks: _, ...rest } = json
      const out: string[] = []
      flatten(rest, "", out)
      for (const value of out) add("value", `${label(ref)}: ${value}`)
    }
    for (const handler of hooks(parsed)) add("hook", handler)
    for (const ref of docs) {
      // a folder of rule files, none of which is missing on its own: a rule it loses shows as its id
      if (ref.endsWith("/")) {
        const named = (folder: string) =>
          [...files.keys()].flatMap(
            (path) => path.match(new RegExp(`(?:^|/)${folder}([^/]+)\\.md$`))?.[1] ?? [],
          )
        const names = named(ref).length || !FORMER[ref] ? named(ref) : named(FORMER[ref])
        for (const name of names) add("rule", standing(name.replaceAll("-", " ")))
        continue
      }
      const text = read(ref)
      if (text === undefined) continue
      for (const id of ruleIds(text))
        add("rule", ref === SKILL && !id.startsWith("§ ") ? standing(id) : `${label(ref)}#${id}`)
      for (const line of frontmatter(text)) add("value", `${label(ref)}: ${line}`)
    }
    for (const ref of values) {
      const text = read(ref)
      if (text !== undefined)
        for (const line of launchValues(text)) add("value", `${ref.split("/").pop()}: ${line}`)
    }
  }
  for (const [path, text] of files)
    if (isTestFile(path)) lines.add(`tests\t${path}\t${countTests(path, text)}`)
  return [...lines].sort()
}

// What the head lost or changed against the base: a kind's line either side lacks, an input the head lacks even when the base lacks it too (it hides that input's every line), and a test file whose count fell or that is gone; a test the head adds is no regression, so it shows nowhere.
export const diff = (base: string[], head: string[]): string[] => {
  const counts = (lines: string[]) =>
    new Map(
      lines
        .filter((l) => l.startsWith("tests\t"))
        .map((l) => [l.split("\t")[1]!, Number(l.split("\t")[2])]),
    )
  const before = counts(base)
  const after = counts(head)
  const out: string[] = []
  for (const [path, n] of before) {
    const now = after.get(path)
    if (now === undefined || now < n) out.push(`- tests\t${path}\t${n} -> ${now ?? "gone"}`)
  }
  const kinds = (lines: string[]) => new Set(lines.filter((l) => !l.startsWith("tests\t")))
  const b = kinds(base)
  const h = kinds(head)
  for (const line of b) if (!h.has(line)) out.push(`- ${line}`)
  for (const line of h) if (!b.has(line) || line.split("\t")[1] === "missing") out.push(`+ ${line}`)
  return out.sort((x, y) =>
    x.slice(2) < y.slice(2) ? -1 : x.slice(2) > y.slice(2) ? 1 : x < y ? -1 : 1,
  )
}
