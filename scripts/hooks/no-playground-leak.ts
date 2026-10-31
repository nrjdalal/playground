// PreToolUse hook for the factory's sessions, loaded from the factory settings file and, for a session cmux restored, the project settings, acting only for a factory session (role.ts): refuses a write to a guarded org's surface (Linear, Slack, a repository of an org ext.links guards, through gh, git, curl or the GitHub MCP) whose text holds a factory term, since the factory is private and stays out of every company write in any shape; a Slack MCP chat posting tool's post to a conversation in slack-cleared.json passes, signed where its entry names a signature.
import "../../packages/env/src/aliases"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { dataDir, dataDirOf } from "../../packages/env/src/data-dir"
import { guardedOrgs } from "../../packages/settings/src/ext"
import { coreDir, readPolicy } from "../../packages/settings/src/rendered"
import { implicitRepos, type Repo, remoteRepo, remotes, repoOf } from "./github"
import { guardList, isRecord, isStrings } from "./lists"
import { fromFactory } from "./role"
import {
  type Command,
  CURL_TAKES,
  curlData,
  curlUrls,
  type Env,
  flagFromXargs,
  fromXargs,
  ghApi,
  ghCommand,
  knownVariables,
  lex,
  marked,
  NOT_RUN,
  type Parsed,
  parseFlags,
  pathOf,
  PRINTERS,
  program,
  readPath,
  resolveText,
  run,
  stdinOf,
  type Text,
  UNKNOWN,
  unknown,
  viaXargs,
  visible,
  type Visit,
  type Word,
  type Xargs,
} from "./shell"

type Environment = Record<string, string | undefined>
// Where a write lands: on a surface the guard guards, off it, or somewhere the hook cannot tell.
type Target = { label: string; where: "guarded" | "other" | "unknown" }
// What a hit in a write's text is, and the plain-words fix its refusal names.
export type Hit = { detail: string; fix: string }
// What one guard guards, so another guard (no-public-leak) reads every write as this one does: the repositories it guards, what in a text it refuses, how its refusal reads, and whether Linear and Slack (hosts) and git commits and pushes count.
export type Policy = {
  find: (text: string) => Hit | undefined
  git: boolean
  guard: string
  guarded: (repo: Repo) => boolean
  hosts: boolean
  place: string
  what: string
  why: string
}
type Terms = {
  aliases: string[]
  everyday: string[]
  names: string[]
  paths: string[]
  probe: string
  sessions: { roles: string[]; sins: string[] }
}

const EMPTY_TERMS: Terms = {
  aliases: [],
  everyday: [],
  names: [],
  paths: [],
  probe: "probe",
  sessions: { roles: [], sins: [] },
}
const isTerms = (value: unknown): value is Terms =>
  isRecord(value) &&
  ["aliases", "everyday", "names", "paths"].every((key) => isStrings(value[key])) &&
  typeof value.probe === "string" &&
  isRecord(value.sessions) &&
  isStrings(value.sessions.roles) &&
  isStrings(value.sessions.sins)
// Read at each check() from its lists folder, never at load, so a broken list refuses (lists.ts) rather than crash the hook open.
let terms = EMPTY_TERMS
// Slack conversations the owner cleared for talk about the factory, by id, a channel with a signature passing only posts that end with it.
type Cleared = Record<string, { name: string; signature?: string }>
const isCleared = (value: unknown): value is Cleared =>
  isRecord(value) &&
  Object.values(value).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      (entry.signature === undefined || typeof entry.signature === "string"),
  )
let CLEARED: Cleared = {}
// The Slack MCP tools that post to the conversation their `channel` names; any other tool naming a `channel` (a user group) writes elsewhere. Curl is never cleared, since the hook cannot parse its data exactly as Slack does.
const CHAT_TOOL = /^chat_(?:me_message|post_ephemeral|post_message|schedule_message|update)$/
// Each cleared posting tool, by the key naming its conversation and the key holding its text; the claude.ai Slack connector's tool is cleared for a signed channel alone.
const POST_KEYS = { channel: "channel", text: "text" }
const CONNECTOR_TOOL = "slack_send_message"
const CONNECTOR_KEYS = { channel: "channel_id", text: "message" }
// The cleared conversations that take only signed posts, which curl may never write to.
const signed = (): string[] => Object.keys(CLEARED).filter((c) => CLEARED[c].signature)
// A key naming a destination beside the tool's own channel key, which a Slack server may post to instead.
const OTHER_DESTINATION = /channel|conversation/i
// Fields Slack shows in place of a post's text, where a signature in the text would not show; blocks pass only as link chips (chipsSigned).
const RICH = ["attachments", "blocks", "markdown_text"]

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Link chips in a signed channel: blocks, an array or its JSON text, made only of rich_text blocks of rich_text_section elements holding text and links, whose last line is one italic text element reading the signature's words.
function chipsSigned(blocks: unknown, signature: string): boolean {
  let parsed = blocks
  if (typeof blocks === "string") {
    try {
      parsed = JSON.parse(blocks)
    } catch {
      return false
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return false
  const children: Json[] = []
  // Each section starts a line of its own.
  const starts = new Set<Json>()
  for (const block of parsed) {
    if (!isJson(block) || block.type !== "rich_text" || !Array.isArray(block.elements)) return false
    if (!block.elements.length) return false
    for (const section of block.elements) {
      if (!isJson(section) || section.type !== "rich_text_section") return false
      if (!Array.isArray(section.elements)) return false
      if (isJson(section.elements[0])) starts.add(section.elements[0])
      for (const child of section.elements) {
        if (!isJson(child)) return false
        const text = child.type === "text" && typeof child.text === "string"
        const link =
          child.type === "link" &&
          typeof child.url === "string" &&
          (child.text === undefined || typeof child.text === "string")
        if (!text && !link) return false
        children.push(child)
      }
    }
  }
  const last = children.findLast((c) => c.type !== "text" || String(c.text).trim())
  const style = last?.style
  if (last?.type !== "text" || !isJson(style) || style.italic !== true) return false
  const text = String(last.text).trimEnd()
  const before = children[children.indexOf(last) - 1]
  const opensLine =
    text.includes("\n") || starts.has(last) || String(before?.text ?? "").endsWith("\n")
  return opensLine && text.split("\n").at(-1)?.trim() === signature.replace(/^_(.*)_$/, "$1")
}
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const HANDLE = /^[a-z\d][\w.-]{1,63}$/i
const MAX_ROSTER_BYTES = 1_048_576
// The checkout this hook runs from, whose skills/ holds the factory's skills.
const CHECKOUT = join(import.meta.dir, "..", "..")

// Every agent's name in the roster, since sessions are renamed and no list in the repo keeps up; a name that is an everyday word (`builder`) is left out so a guarded org's own words pass, and a roster that is missing or unreadable adds none.
export function rosterNames(environment: Environment): string[] {
  const path = join(dataDirOf(environment), "roster.json")
  try {
    if (statSync(path).size > MAX_ROSTER_BYTES) return []
    const agents = (JSON.parse(readFileSync(path, "utf8")) as { agents?: unknown })?.agents
    if (!Array.isArray(agents)) return []
    return agents.flatMap((a) => {
      const name = (a as { name?: unknown } | null)?.name
      return typeof name === "string" && notEveryday(name) ? [name] : []
    })
  } catch {
    return []
  }
}

const notEveryday = (name: string): boolean =>
  HANDLE.test(name) && !terms.everyday.some((w) => w.toLowerCase() === name.toLowerCase())

// Our own skills' names (`skills/playground/<name>/SKILL.md`), read each call so a new skill is covered with no edit; ZeroStarter's in `skills/zerostarter` are everyday words (dev, design, release), and so is the skill named for the company.
export function skillNames(checkout = CHECKOUT): string[] {
  const ours = join(checkout, "skills", "playground")
  try {
    return readdirSync(ours, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ours, d.name, "SKILL.md")))
      .map((d) => d.name)
      .filter(notEveryday)
  } catch {
    return []
  }
}

// A term stands alone: no letter or digit touches it, so `_` and `-` count as edges (`PLAYGROUND_ROLE` holds playground), and a name ending in `_` is a prefix (`PLAYGROUND_` holds `PLAYGROUND_ROLE`). A session pattern takes only the seven sins, so `worker-pool` and `probe-path` are not one; other probes are matched by their roster name.
function pattern(environment: Environment, checkout = CHECKOUT): RegExp {
  const sources = [
    ...[...terms.names, ...terms.aliases, ...rosterNames(environment), ...skillNames(checkout)].map(
      (n) => escape(n).replace(/ /g, "[\\s_-]+") + (n.endsWith("_") ? "[a-z\\d_]*" : ""),
    ),
    ...terms.paths.map(escape),
    ...(terms.sessions.sins.length
      ? [
          `${escape(terms.probe)}-(?:(?:${terms.sessions.roles.join("|")})-)?(?:${terms.sessions.sins.join("|")})`,
          `(?:${terms.sessions.roles.join("|")})-(?:${terms.sessions.sins.join("|")})`,
        ]
      : []),
  ]
  // with no term at all, a pattern that matches nothing, since an empty alternation matches everywhere
  if (!sources.length) return /(?!)/
  return new RegExp(`(?<![a-z\\d])(?:${sources.join("|")})(?![a-z\\d])`, "i")
}

// Built once per call, from the terms file, the roster and the skills as they stand.
let TERM = pattern({})

const REPHRASE = "Say it without the term: name the work, not who did it or how it is run."
const READABLE = `Put the text in the command itself, or write the text to a file with the Write tool first, then run the command again in a call of its own that names that file by its literal absolute path (--body-file /abs/body.md, or -F /abs/msg.md for a commit). ${NOT_RUN}`
const MCP_READABLE = "Pass the input as an object whose fields are strings."

type Spec = { files: string[]; takes: Set<string>; texts: string[] }

const spec = (texts: string[], files: string[], others: string[] = []): Spec => ({
  files,
  takes: new Set([...files, ...others, ...texts, "-R", "--repo"]),
  texts,
})
const BODY = ["-b", "--body"]
const BODY_FILE = ["-F", "--body-file"]
const CLOSING = spec(["-c", "--comment"], [], ["-r", "--reason", "--duplicate-of"])
const EDIT = [
  "--add-assignee",
  "--add-label",
  "--add-project",
  "--add-reviewer",
  "-B",
  "--base",
  "-m",
  "--milestone",
  "--remove-assignee",
  "--remove-label",
  "--remove-project",
  "--remove-reviewer",
]
const NEW = [
  "-a",
  "--assignee",
  "-B",
  "--base",
  "-l",
  "--label",
  "-m",
  "--milestone",
  "-p",
  "--project",
  "-r",
  "--reviewer",
  "--recover",
  "-T",
  "--template",
]
// Each gh write, by the flags holding the text it posts, the flags naming a file of that text, and its other flags that take a value.
const GH_WRITES = new Map<string, Spec>([
  ["issue close", CLOSING],
  ["issue comment", spec([...BODY, "--attach"], BODY_FILE)],
  ["issue create", spec([...BODY, "-t", "--title"], BODY_FILE, NEW)],
  ["issue edit", spec([...BODY, "-t", "--title"], BODY_FILE, EDIT)],
  ["issue reopen", CLOSING],
  ["label create", spec(["-d", "--description"], [], ["-c", "--color"])],
  ["label edit", spec(["-d", "--description", "-n", "--name"], [], ["-c", "--color"])],
  ["pr close", CLOSING],
  ["pr comment", spec([...BODY, "--attach"], BODY_FILE)],
  ["pr create", spec([...BODY, "--attach", "-H", "--head", "-t", "--title"], BODY_FILE, NEW)],
  ["pr edit", spec([...BODY, "-t", "--title"], BODY_FILE, EDIT)],
  [
    "pr merge",
    spec([...BODY, "-t", "--subject"], BODY_FILE, ["-A", "--author-email", "--match-head-commit"]),
  ],
  ["pr reopen", CLOSING],
  ["pr review", spec(BODY, BODY_FILE)],
  [
    "release create",
    spec(
      ["-n", "--notes", "-t", "--title"],
      ["-F", "--notes-file"],
      ["--discussion-category", "--notes-start-tag", "--target"],
    ),
  ],
  [
    "release edit",
    spec(
      ["-n", "--notes", "-t", "--title", "--tag"],
      ["-F", "--notes-file"],
      ["--discussion-category", "--target"],
    ),
  ],
])
const GH_GROUPS = new Set(["api", "issue", "label", "pr", "release"])
const PR_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/i
const GIT_GLOBALS = new Set(["-C", "-c", "--exec-path", "--git-dir", "--namespace", "--work-tree"])
const COMMIT_TAKES = new Set([
  "--author",
  "-c",
  "-C",
  "--cleanup",
  "--date",
  "-F",
  "--file",
  "--fixup",
  "-m",
  "--message",
  "--pathspec-from-file",
  "--reedit-message",
  "--reuse-message",
  "--squash",
  "-t",
  "--template",
  "--trailer",
])
const PUSH_TAKES = new Set(["--exec", "-o", "--push-option", "--receive-pack", "--repo"])
const MCP_TOOL = /^mcp__(.+?)__(.+)$/
const READ_TOOL =
  /^(?:download|extract|fetch|get|list|read|search)_|_(?:history|info|list|read|replies|search|unreads)$/
const INNER = new Set(["curl", "gh", "git"])
// A Bash command naming none of these is left alone before any parsing; $'...' can spell any word, so it always counts.
const MAYBE = /curl|gh|git/i
// What an internal error still refuses: a call to a guarded org's tool or a writing command.
const WRITE_CALL = /\b(?:curl|gh|git)\b|github|linear|slack/i

const leakPolicy = (orgs: Set<string>): Policy => ({
  find: (text) => {
    const term = TERM.exec(visible(text))?.[0]
    return term ? { detail: `"${term}", a factory term`, fix: REPHRASE } : undefined
  },
  git: true,
  guard: "no-playground-leak",
  guarded: (repo) => orgs.has(repo.owner.toLowerCase()),
  hosts: true,
  place: "a guarded org",
  what: "a factory term",
  why: "the factory is private, so nothing about it, its skills or its sessions goes into anything a guarded org sees, in any shape.",
})
let policy = leakPolicy(new Set())

const lower = (text: string) => text[0].toLowerCase() + text.slice(1)

function refuse(what: string, target: Target, detail: string, fix: string): string {
  return `${policy.guard} hook refused ${what} to ${target.label}: ${detail}. ${policy.why} ${fix}`
}

// `texts` must be read before the write runs; `extras` (a PR number, a URL) are searched only when the hook can read them.
async function judge(
  what: string,
  target: Target,
  texts: Text[],
  env: Env,
  extras: Text[] = [],
): Promise<string | undefined> {
  if (target.where === "other") return
  const resolved = await Promise.all(texts.map((t) => resolveText(t, env)))
  const seen = (await Promise.all(extras.map((t) => resolveText(t, env)))).filter((t) => !t.unknown)
  const hit = [...resolved, ...seen].map((t) => policy.find(t.value)).find(Boolean)
  if (target.where === "unknown") {
    if (!hit) return
    return refuse(
      what,
      target,
      `the hook cannot tell whether it writes to ${policy.place}, and its text holds ${hit.detail}`,
      `Name where it goes by its literal value in a call of its own (gh -R <owner>/<repo>, the pull request number or URL, git -C /abs/checkout, the URL itself, or a REST endpoint naming the repository in place of a GraphQL node id), or ${lower(hit.fix)} ${NOT_RUN}`,
    )
  }
  if (hit) return refuse(what, target, `its text holds ${hit.detail}`, hit.fix)
  const hidden = resolved.find((t) => t.unknown)
  if (hidden) {
    return refuse(
      what,
      target,
      `the hook cannot read its text before it runs (it comes from ${hidden.unknown}), so it may hold ${policy.what}`,
      READABLE,
    )
  }
}

// Guarded when any candidate is a repository the policy guards, unknown when one cannot be read or none is named, else not guarded.
function decide(candidates: (Repo | undefined)[]): Target {
  const ours = candidates.find((c) => c && policy.guarded(c))
  if (ours) return { label: `${ours.owner}/${ours.repo}`, where: "guarded" }
  if (candidates.length === 0 || candidates.some((c) => !c)) {
    return { label: "a repository the hook cannot resolve", where: "unknown" }
  }
  return { label: "", where: "other" }
}

const leak: Visit = async (cmd, parsed, env) => {
  const { args, first, name, xargs } = parsed
  const head = args[0]?.value ?? ""
  if (name === "gh" || (first?.unknown && GH_GROUPS.has(head)))
    return gh(args, cmd, env, parsed.local, xargs)
  if (name === "git" || (first?.unknown && (head === "commit" || head === "push")))
    return policy.git ? git(args, cmd, env) : undefined
  if (name === "curl") return curl(args, cmd, env, xargs)
  if (PRINTERS.has(name)) return
  // A wrapper the reader does not know (`vault run -- gh ...`, `uv run git ...`) runs the command after it.
  const at = args.findIndex((a) => INNER.has(program(a.value)))
  if (at === -1) return
  const inner: Parsed = {
    ...parsed,
    args: args.slice(at + 1),
    first: args[at],
    name: program(args[at].value),
  }
  return leak(cmd, inner, env)
}

async function gh(
  args: Word[],
  cmd: Command,
  env: Env,
  local: Map<string, Text>,
  xargs: Xargs,
): Promise<string | undefined> {
  const { head, repos, rest } = ghCommand(args)
  if (head[0] === "api") return api(rest, cmd, env, local, xargs)
  const key = head.join(" ")
  const found = GH_WRITES.get(key)
  if (!found) return
  const { flags, positionals } = parseFlags(rest, found.takes)
  const texts: Text[] = []
  for (const { name, value } of flags) {
    const posts = found.texts.includes(name) || found.files.includes(name)
    if (!value) {
      if (posts) texts.push(unknown(`${name} with no value`))
    } else if (found.texts.includes(name)) texts.push(value)
    else if (found.files.includes(name)) {
      texts.push(
        value.value === "-" && !value.unknown
          ? await stdinOf(cmd, env)
          : await readPath(value, env),
      )
    } else if (name === "-R" || name === "--repo") repos.push(value)
  }
  if (xargs && !xargs.replace) texts.push(unknown("the arguments xargs appends"))
  if (rest.some((a) => flagFromXargs(a, xargs))) {
    texts.push(unknown(`what xargs puts in place of ${xargs?.replace}`))
  }
  const flagged = repos.map((r) => (fromXargs(r, xargs) ? undefined : repoOf(r)))
  // A positional the hook cannot read may be a pull request URL, which picks the repository.
  const urls = positionals.flatMap((p) => {
    if (p.unknown || p.reads?.length || p.value.includes(UNKNOWN) || fromXargs(p, xargs))
      return [undefined]
    return PR_URL.test(p.value) ? [repoOf(p)] : []
  })
  const named = [...flagged, ...urls]
  const placed = urls.some(Boolean)
  const implicit = flagged.length > 0 || placed ? [] : implicitRepos(env, local)
  if (!placed) {
    const refused = unplaced(`gh ${key}`, flagged.length > 0 ? flagged : implicit, env)
    if (refused) return refused
  }
  const target = decide(named.length > 0 ? named : implicit)
  if (key === "pr create" && target.where !== "other") texts.push(...prCreate(rest, env))
  return judge(
    `gh ${key}`,
    target,
    texts.map((t) => viaXargs(t, xargs)),
    env,
    positionals,
  )
}

// A gh write whose repository comes from a value the hook cannot read (-R $R, GH_REPO=$R, repos/$R) or a directory it lost (a cd, popd or env -C it cannot follow) may write to a guarded org, so it is refused before its text is judged.
function unplaced(what: string, source: (Repo | undefined)[], env: Env): string | undefined {
  const lost = source.length === 0 && !env.cwd
  if (!lost && source.every(Boolean)) return
  return refuse(
    what,
    decide([]),
    lost
      ? "the hook cannot tell which repository it writes to, since it names none and runs in a directory the hook lost (after a cd, popd or env -C it cannot follow)"
      : "the hook cannot tell which repository it writes to, since it names it through a value the hook cannot read",
    `Name the repository by its literal value (--repo <owner>/<name>, or repos/<owner>/<name>/... for gh api), or cd to a literal path, in a call of its own. ${NOT_RUN}`,
  )
}

// What `gh pr create` publishes beyond its flags: the branch it opens from and the commits it may push, and with --fill the messages it reads.
function prCreate(rest: Word[], env: Env): Text[] {
  const values = rest.map((w) => w.value)
  const texts = [
    gitText(
      env.cwd,
      ["log", "--format=%B", "-n", "500", "HEAD", "--not", "--remotes"],
      "the commits it may push",
    ),
  ]
  if (!values.some((v) => /^(?:-H|--head)(?:=|$)/.test(v))) texts.push(branch(env.cwd))
  if (values.some((v) => v === "-f" || v.startsWith("--fill"))) {
    const at = values.findIndex((v) => /^(?:-B|--base)(?:=|$)/.test(v))
    const base =
      at === -1 ? "HEAD" : values[at].includes("=") ? values[at].split("=")[1] : values[at + 1]
    texts.push(
      base && !base.includes(UNKNOWN)
        ? gitText(
            env.cwd,
            ["log", "--format=%B", "-n", "500", `origin/${base}..HEAD`],
            "the commits --fill reads",
          )
        : unknown("the base --fill reads from"),
    )
  }
  return texts
}

const branch = (dir: string | undefined): Text =>
  gitText(dir, ["branch", "--show-current"], "the current branch")

// gh api fields whose value is text a write posts; the rest (a number, a SHA) are searched only when readable.
const TEXT_FIELD =
  /body|branch|comment|description|head|message|name|notes|query|ref|subject|text|title/i

async function api(
  args: Word[],
  cmd: Command,
  env: Env,
  local: Map<string, Text>,
  xargs: Xargs,
): Promise<string | undefined> {
  const request = await ghApi(args, cmd, env, xargs)
  if (!request || ["DELETE", "GET", "HEAD"].includes(request.method)) return
  const { endpoint, fields, inputs } = request
  const posted = (f: { key: string }) =>
    endpoint.value === "graphql" || f.key.includes(UNKNOWN) || TEXT_FIELD.test(f.key)
  const texts = [...fields.filter(posted).map((f) => f.text), ...inputs]
  const extras = [endpoint, ...fields.filter((f) => !posted(f)).map((f) => f.text)]
  if (endpoint.value === "graphql") {
    const documents = await Promise.all(
      [...fields.filter((f) => f.key === "query").map((f) => f.text), ...inputs].map((d) =>
        resolveText(d, env),
      ),
    )
    if (!documents.some((d) => d.unknown || /\bmutation\b/.test(d.value))) return
    const target: Target = {
      label: "a repository named only by a GraphQL node id",
      where: "unknown",
    }
    return judge("gh api graphql", target, texts, env, extras)
  }
  const value = endpoint.value
  const host = hostTarget(value)
  if (host) return judge(`gh api ${host.label}`, host, texts, env, extras)
  const path = value
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^api\/v3\//, "")
  const repo = /^repos\/([^/]+)\/([^/]+)/.exec(path)
  const org = /^orgs\/([^/]+)/.exec(path)
  const what = `gh api ${path.split("?")[0]}`
  let candidates: (Repo | undefined)[]
  if (fromXargs(endpoint, xargs)) candidates = [undefined]
  else if (repo?.[1] === "{owner}") candidates = implicitRepos(env, local)
  else if (repo) candidates = [marked(repo[0]) ? undefined : { owner: repo[1], repo: repo[2] }]
  else if (org) candidates = [marked(org[0]) ? undefined : { owner: org[1], repo: "*" }]
  else if (marked(value) && (/^(repos|orgs)\//.test(path) || marked(path.split("/")[0])))
    candidates = [undefined]
  else if (marked(value)) return judge(what, decide([undefined]), texts, env, extras)
  else return
  return unplaced(what, candidates, env) ?? judge(what, decide(candidates), texts, env, extras)
}

// A URL on Linear's or Slack's API is a guarded org's; GitHub's API is judged by the repository in its path.
function hostTarget(url: string): Target | undefined {
  const host = /^[a-z][a-z\d+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1]?.toLowerCase()
  if (!host || !policy.hosts) return
  if (host === "linear.app" || host.endsWith(".linear.app"))
    return { label: "Linear", where: "guarded" }
  if (host === "slack.com" || host.endsWith(".slack.com"))
    return { label: "Slack", where: "guarded" }
}

async function curl(
  args: Word[],
  cmd: Command,
  env: Env,
  xargs: Xargs,
): Promise<string | undefined> {
  const { flags, positionals } = parseFlags(args, CURL_TAKES)
  const urls = curlUrls(flags, positionals)
  const targets = urls.map((u): Target => {
    const value = visible(u.value)
    if (u.unknown || u.reads?.length || value.includes(UNKNOWN) || fromXargs(u, xargs))
      return { label: "a URL the hook cannot read", where: "unknown" }
    // curl takes a URL with no scheme as http.
    const url = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
    const host = hostTarget(url)
    if (host) return host
    if (/^https?:\/\/api\.github\.com(?::\d+)?\/graphql(?:[/?#]|$)/i.test(url))
      return { label: "a repository named only by a GraphQL node id", where: "unknown" }
    const repo = /api\.github\.com\/repos\/([^/\s]+)\/([^/\s?#]+)/i.exec(value)
    return repo ? decide([{ owner: repo[1], repo: repo[2] }]) : { label: "", where: "other" }
  })
  const target =
    targets.find((t) => t.where === "guarded") ?? targets.find((t) => t.where === "unknown")
  if (!target) return
  const data = await curlData(flags, cmd, env)
  // A read (no data, or -G turning data into a query) names a channel without writing to it; a chat method writes even from its query alone.
  const get = flags.some((f) => f.name === "-G" || f.name === "--get")
  const writes = (data.length > 0 && !get) || urls.some((u) => /\/api\/chat\./i.test(u.value))
  if (writes && targets.some((t) => t.label === "Slack")) {
    const read = await Promise.all([...urls, ...data].map((t) => resolveText(t, env)))
    const id = signed().find((c) => read.some((t) => t.value.includes(c)))
    if (id) {
      return `no-playground-leak hook refused curl to ${CLEARED[id].name}: post there through the Slack MCP chat tools, which check that its last line is ${CLEARED[id].signature}.`
    }
  }
  if (xargs && !xargs.replace) data.push(unknown("the arguments xargs appends"))
  return judge(
    "curl",
    target,
    data.map((t) => viaXargs(t, xargs)),
    env,
    urls,
  )
}

// A Slack MCP post to a cleared conversation, its channel and text read at `at`: "" when it passes, why it is refused when a signed conversation's post is not signed, or undefined when it names a conversation not cleared (or, `signedOnly`, one with no signature) or another destination, to be judged as any write to a guarded org.
function clearedPost(
  what: string,
  input: Record<string, unknown>,
  at: { channel: string; text: string },
  signedOnly: boolean,
): string | undefined {
  const keys = Object.keys(input)
  if (keys.some((k) => k !== at.channel && OTHER_DESTINATION.test(k))) return
  const channel = input[at.channel]
  const text = input[at.text]
  if (typeof channel !== "string" || !Object.hasOwn(CLEARED, channel)) return
  const { name, signature } = CLEARED[channel]
  if (!signature) return signedOnly ? undefined : ""
  const signed = typeof text === "string" && text.trimEnd().split("\n").at(-1) === signature
  const rich = keys.filter((k) => RICH.includes(k))
  if (signed && rich.every((k) => k === "blocks" && chipsSigned(input.blocks, signature))) return ""
  return `no-playground-leak hook refused ${what} to ${name}: every post there ends with the line ${signature}, since it goes out through the owner's Slack account and must never read as the owner's own. Put that line last in its text, with no attachments or markdown_text; blocks pass only as rich_text sections of text and links whose last line is that signature as italic text, then run it again.`
}

// The text of a git read in a checkout, or an unknown naming what it stood for when the read fails.
function gitText(dir: string | undefined, args: string[], what: string): Text {
  if (!dir) return unknown(`${what}, in a checkout the hook cannot resolve`)
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stderr: "ignore",
  })
  return proc.exitCode === 0 ? { value: proc.stdout.toString() } : unknown(what)
}

async function git(args: Word[], cmd: Command, env: Env): Promise<string | undefined> {
  let dir = env.cwd
  let k = 0
  for (; k < args.length; k++) {
    const v = args[k].value
    if (v === "-C") {
      const next = args[++k]
      dir = next ? pathOf(next, { ...env, cwd: dir }) : undefined
    } else if (GIT_GLOBALS.has(v)) k++
    else if (!v.startsWith("-")) break
  }
  const sub = args[k]?.value
  if (sub !== "commit" && sub !== "push") return
  const rest = args.slice(k + 1)
  const here = { ...env, cwd: dir }
  const checkout = dir ? remotes(dir) : []
  if (sub === "push") return push(rest, here, checkout)
  // A checkout with no remote publishes nothing; one the hook cannot find may be a guarded org's.
  if (dir && checkout.length === 0) return
  const { flags } = parseFlags(rest, COMMIT_TAKES)
  const texts: Text[] = [branch(dir)]
  const extras: Text[] = []
  for (const { name, value } of flags) {
    if (!value) continue
    if (name === "-m" || name === "--message") texts.push(value)
    else if (name === "-F" || name === "--file") {
      texts.push(
        value.value === "-" && !value.unknown
          ? await stdinOf(cmd, here)
          : await readPath(value, here),
      )
    } else if (["-C", "-c", "--reedit-message", "--reuse-message"].includes(name)) {
      texts.push(
        value.unknown || value.reads?.length
          ? unknown("the message of a commit the hook cannot name")
          : gitText(
              dir,
              ["log", "-1", "--format=%B", value.value],
              `the message of ${value.value}`,
            ),
      )
    } else extras.push(value)
  }
  return judge("git commit", decide(dir ? checkout : [undefined]), texts, env, extras)
}

// git push publishes the names of the refs it pushes and the messages of every commit the remote does not hold yet.
async function push(rest: Word[], env: Env, checkout: Repo[]): Promise<string | undefined> {
  const { flags, positionals } = parseFlags(rest, PUSH_TAKES)
  const names = new Set(flags.map((f) => f.name))
  const [remote, ...refspecs] = positionals
  let target: Target
  let remoteName: string | undefined
  if (!remote) target = decide(env.cwd ? checkout : [undefined])
  else if (remote.unknown || remote.reads?.length || remote.value.includes(UNKNOWN))
    target = decide([undefined])
  else if (/[:/]/.test(remote.value)) target = decide([remoteRepo(remote.value)])
  else {
    remoteName = remote.value
    const url = gitText(
      env.cwd,
      ["remote", "get-url", remote.value],
      `the URL of remote ${remote.value}`,
    )
    target = decide([url.unknown ? undefined : remoteRepo(url.value)])
  }
  if (target.where === "other") return
  const texts: Text[] = flags.flatMap((f) =>
    f.value && (f.name === "-o" || f.name === "--push-option") ? [f.value] : [],
  )
  const sources: string[] = []
  if (names.has("--all") || names.has("--branches") || names.has("--mirror")) {
    texts.push(
      gitText(
        env.cwd,
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        "the branches it pushes",
      ),
    )
    sources.push("--branches")
  }
  if (names.has("--tags") || names.has("--follow-tags") || names.has("--mirror")) {
    texts.push(
      gitText(
        env.cwd,
        ["for-each-ref", "--format=%(refname:short)%0a%(contents)", "refs/tags"],
        "the tags it pushes",
      ),
    )
  }
  const deleting = names.has("--delete") || names.has("-d")
  for (const spec of refspecs) {
    texts.push(spec)
    if (spec.unknown || spec.reads?.length || spec.value.includes(UNKNOWN)) continue
    const [source, destination] = spec.value.replace(/^\+/, "").split(":")
    // `git push origin HEAD` names the remote branch after the current one.
    if (destination === undefined && (source === "HEAD" || source === "@"))
      texts.push(branch(env.cwd))
    if (source !== "" && !deleting) sources.push(source)
  }
  if (refspecs.length === 0 && sources.length === 0) {
    texts.push(branch(env.cwd))
    sources.push("HEAD")
  }
  if (sources.length > 0) {
    const not = remoteName ? `--remotes=${remoteName}` : "--remotes"
    texts.push(
      gitText(
        env.cwd,
        ["log", "--format=%B", "-n", "500", ...sources, "--not", not],
        "the messages of the commits it pushes",
      ),
    )
  }
  return judge("git push", target, texts, env)
}

function strings(node: unknown): string[] {
  if (typeof node === "string") return [node]
  if (Array.isArray(node)) return node.flatMap(strings)
  if (typeof node === "object" && node !== null) return Object.values(node).flatMap(strings)
  return []
}

function mcp(tool: string, input: Record<string, unknown> | undefined): string | undefined {
  const [, server = "", name = ""] = MCP_TOOL.exec(tool) ?? []
  const surface = /linear/i.test(server)
    ? "Linear"
    : /slack/i.test(server)
      ? "Slack"
      : /github/i.test(server)
        ? "GitHub"
        : undefined
  if (!surface || READ_TOOL.test(name) || (surface !== "GitHub" && !policy.hosts)) return
  const what = tool.replace(/^mcp__/, "")
  let target: Target = { label: surface, where: "guarded" }
  if (!input)
    return refuse(what, target, "its input is not an object the hook can read", MCP_READABLE)
  if (surface === "Slack" && (CHAT_TOOL.test(name) || name === CONNECTOR_TOOL)) {
    const connector = name === CONNECTOR_TOOL
    const verdict = clearedPost(what, input, connector ? CONNECTOR_KEYS : POST_KEYS, connector)
    if (verdict !== undefined) return verdict || undefined
  }
  if (surface === "GitHub") {
    const owner = input.owner ?? input.organization
    if (owner === undefined) return
    if (typeof owner !== "string") {
      return refuse(
        what,
        { label: "GitHub", where: "unknown" },
        "its owner is not text the hook can read",
        MCP_READABLE,
      )
    }
    const repo = { owner, repo: typeof input.repo === "string" ? input.repo : "*" }
    if (!policy.guarded(repo)) return
    target = { label: `${repo.owner}/${repo.repo}`, where: "guarded" }
  }
  const hit = strings(input).map(policy.find).find(Boolean)
  if (hit) return refuse(what, target, `its text holds ${hit.detail}`, hit.fix)
}

// The cheap first look, made with quotes and backslashes gone so `g\it` or `cu''rl` still counts.
function candidate(command: string): boolean {
  return command.includes("$'") || MAYBE.test(command.replace(/[\\'"]/g, ""))
}

// Fails closed only on a call that may carry a factory term to a guarded org (leakPolicy, over the orgs the data folder's policy names, or a policy it cannot read): an error on any other call lets it run, so a parser bug cannot block every call.
export async function check(
  raw: string,
  environment: Environment = process.env,
  checkout = CHECKOUT,
  lists = join(coreDir(), "lists"),
): Promise<string | undefined> {
  const loadedTerms = await guardList(
    "no-playground-leak",
    "playground-terms",
    isTerms,
    EMPTY_TERMS,
    environment,
    join(lists, "playground-terms.json"),
  )
  const loadedCleared = await guardList(
    "no-playground-leak",
    "slack-cleared",
    isCleared,
    {},
    environment,
    join(lists, "slack-cleared.json"),
  )
  const refusal = loadedTerms.refusal ?? loadedCleared.refusal
  if (refusal) return refusedList(raw, refusal)
  terms = loadedTerms.list ?? EMPTY_TERMS
  CLEARED = loadedCleared.list ?? {}
  TERM = pattern(environment, checkout)
  const read = await readPolicy(dataDir(environment))
  if (read.refusal !== undefined)
    return refusedList(
      raw,
      `no-playground-leak hook refused this call: ${read.refusal}, then run the call again.`,
    )
  return inspectAs(leakPolicy(new Set(guardedOrgs(read.settings.values))), raw, environment)
}

// A list's refusal, given only to a call that may write somewhere.
export const refusedList = (raw: string, refusal: string): string | undefined =>
  WRITE_CALL.test(subjectOf(raw)) ? refusal : undefined

// Reads the call as a write under the policy given: an error refuses only a writing call whose text holds a hit.
export async function inspectAs(
  given: Policy,
  raw: string,
  environment: Environment,
): Promise<string | undefined> {
  policy = given
  try {
    return await inspect(raw, environment)
  } catch (error) {
    const subject = subjectOf(raw)
    if (!WRITE_CALL.test(subject) || !policy.find(subject)) return
    return `${policy.guard} hook could not read this call (${error}), which may carry ${policy.what} to ${policy.place}, so it refuses it. Split it into plain commands and run them again.`
  }
}

// What an error is judged by: the Bash command, or the tool's name and input, never its cwd.
function subjectOf(raw: string): string {
  try {
    const { tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as {
      tool_input?: { command?: unknown }
      tool_name?: unknown
    }
    if (tool === "Bash" && typeof toolInput?.command === "string") return toolInput.command
    return `${String(tool)} ${JSON.stringify(toolInput)}`
  } catch {
    return raw
  }
}

async function inspect(raw: string, environment: Environment): Promise<string | undefined> {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = undefined
  }
  if (typeof payload !== "object" || payload === null) {
    return WRITE_CALL.test(raw) && policy.find(raw)
      ? `${policy.guard} hook could not parse its input, which may carry ${policy.what} to ${policy.place}, so it refuses the call.`
      : undefined
  }
  const { cwd, tool_input: toolInput, tool_name: tool } = payload as Record<string, unknown>
  const input =
    typeof toolInput === "object" && toolInput !== null
      ? (toolInput as Record<string, unknown>)
      : undefined
  if (tool === "Bash") {
    const command = input?.command
    if (typeof command !== "string" || !candidate(command)) return
    const directory = typeof cwd === "string" ? cwd : undefined
    const env: Env = {
      cwd: directory,
      files: new Map(),
      known: knownVariables(command, environment, directory),
      process: environment,
      vars: new Map(),
    }
    return run(lex(command, env.known), env, leak)
  }
  if (typeof tool === "string") return mcp(tool, input)
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
