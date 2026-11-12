// bun run verify memory: every auto-memory file on this machine, the trial's folders under the data folder's memory/ and Claude Code's own under its projects, holds no private trace, and each index stays small enough to load whole; each hit names its file, line and kind, never its text.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

import { dataDirOf } from "../../../env/src/data-dir"
import { readPolicySync } from "../../../settings/src/rendered"
import { orgTerms, leg1 } from "../core-audit/audit"
import { type File, list, readable } from "../trace-count/count"
import {
  patterns,
  publicListPath,
  type PublicList,
  type Repos,
  reposOf,
} from "../trace-count/kinds"

type Environment = Record<string, string | undefined>
export type MemoryHit = { kind: string; line: number; path: string }

// Claude Code loads an index's first 200 lines or 25 KB at a start; 18 KB keeps it under about 5k tokens (estimated)
export const INDEX_LINES = 200
export const INDEX_BYTES = 18 * 1024

// The trace kinds that name a person, an org or a private record, as no-public-leak reads them; the repo-only kinds (an issue number, an old factory word) are a note's fair words.
const PRIVATE = new Set([
  "archiveLinks",
  "companies",
  "companyName",
  "emails",
  "handles",
  "linearKeys",
  "names",
  "ownerName",
  "slackIds",
])

// A credential's own shape: an Anthropic, GitHub, Slack or AWS key, a private key's header, and a database URL that carries a password.
const SECRETS: [string, RegExp][] = [
  ["anthropicKey", /sk-ant-[A-Za-z0-9_-]{8,}/g],
  ["githubToken", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ["slackToken", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["awsKey", /\bAKIA[0-9A-Z]{16}\b/g],
  ["privateKey", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["databasePassword", /\b[a-z][a-z0-9+]*:\/\/[^\s:@/]+:[^\s@/]+@/gi],
]

// Prod data by its shape: a production host (a dotted name with a prod or production label, a file name ending in a code or config extension left out) and a public IPv4 address (loopback, private, link-local, shared CGNAT, multicast and netmask ones left out); a production figure has no shape, so the optimizer's review reads each note for one (ADR 0022).
const PROD: [string, RegExp][] = [
  [
    "prodHost",
    /\b(?:[a-z0-9-]+[.-])*prod(?:uction)?(?:-[a-z0-9-]+)?(?:\.[a-z0-9-]+)+(?<!\.(?:c?js|env|json|jsx|local|lock|log|md|mjs|py|sh|toml|tsx?|txt|ya?ml))\b/gi,
  ],
  [
    "publicAddress",
    /\b(?!(?:0|10|127)\.)(?!2(?:2[4-9]|[3-5]\d)\.)(?!100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)(?!169\.254\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  ],
]

// Each hit in the files: a secret's shape, prod data's shape, a private kind, and an org's own terms when an org is linked.
export function memoryHits(
  files: File[],
  privateList: PublicList,
  repos: Repos,
  orgFiles: (files: File[]) => MemoryHit[] = () => [],
): MemoryHit[] {
  const kinds = [
    ...SECRETS,
    ...PROD,
    ...patterns(privateList, repos).filter(([kind]) => PRIVATE.has(kind)),
  ]
  const hits = files.flatMap(({ path, text }) =>
    text.split("\n").flatMap((raw, i) => {
      const line = readable(raw, repos)
      return kinds.flatMap(([kind, re]) =>
        [...line.matchAll(new RegExp(re.source, re.flags))].length
          ? [{ kind, line: i + 1, path }]
          : [],
      )
    }),
  )
  return [...hits, ...orgFiles(files)]
}

// Each index (MEMORY.md) over 200 lines or 18 KB, which a start loads only in part.
export const indexHits = (files: File[]): MemoryHit[] =>
  files.flatMap(({ path, text }) => {
    if (!path.endsWith("MEMORY.md")) return []
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
    return [
      ...(lines > INDEX_LINES
        ? [{ kind: `index over ${INDEX_LINES} lines (${lines})`, line: 0, path }]
        : []),
      ...(Buffer.byteLength(text) > INDEX_BYTES
        ? [
            {
              kind: `index over ${INDEX_BYTES / 1024} KB (${Buffer.byteLength(text)} bytes)`,
              line: 0,
              path,
            },
          ]
        : []),
    ]
  })

const filesUnder = (folder: string): string[] =>
  existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
    : []

// Every memory file this machine holds: the trial's folders and each project's memory folder in Claude Code's config.
export function memoryFiles(env: Environment): File[] {
  const config = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude")
  const projects = join(config, "projects")
  const folders = [
    join(dataDirOf(env), "memory"),
    ...(existsSync(projects)
      ? readdirSync(projects).map((project) => join(projects, project, "memory"))
      : []),
  ]
  return folders
    .flatMap(filesUnder)
    .filter((path) => statSync(path).size < 5 * 1024 * 1024)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
}

export type MemoryReport = { detail: string; ok: boolean }

// The check: a refusal when the private list or the policy cannot be read, since an empty list would print a false all-clear; else each hit, or a count of the files read.
export async function memoryReport(env: Environment = process.env): Promise<MemoryReport> {
  const read = await list(publicListPath(env))
  if ("refusal" in read) return { detail: read.refusal, ok: false }
  const policy = readPolicySync(dataDirOf(env))
  if (!policy.settings) return { detail: policy.refusal ?? "the policy does not read", ok: false }
  const terms = await orgTerms(env)
  if (terms && "refusal" in terms) return { detail: terms.refusal, ok: false }
  const files = memoryFiles(env)
  const home = env.HOME || homedir()
  const hits = [
    ...memoryHits(files, read.list, reposOf(policy.settings), (all) =>
      terms ? leg1(all, terms) : [],
    ),
    ...indexHits(files),
  ]
  if (!hits.length) return { detail: `${files.length} memory files read, no hit`, ok: true }
  return {
    detail: hits.map((hit) => `~/${relative(home, hit.path)}:${hit.line} ${hit.kind}`).join("; "),
    ok: false,
  }
}
