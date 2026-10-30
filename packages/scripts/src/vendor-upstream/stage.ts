// Vendoring the upstream skills core keeps from their repo, byte for byte, into extensions/core/: this module holds the file work and no network, so the test drives it offline; cli.ts adds the downloads and calls it. The staged files are verified against MANIFEST before the swap, so a changed byte leaves core as it was.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

export type UpstreamFile = { path: string; bytes: Uint8Array }
export type ManifestEntry = { sha: string; path: string }
export type Vendored = { ok: true; files: number } | { ok: false; mismatches: string[] }

// The upstream skills core keeps, the ones in use; `pr` is core's own version, so upstream's is not taken.
export const UPSTREAM_SKILLS = [
  "code-review",
  "diagnosing-bugs",
  "domain-modeling",
  "handoff",
  "research",
  "tdd",
  "to-spec",
  "writing-for-agents",
]

const UPSTREAM_SKILL = /^skills\/[^/]+\/([^/]+)\//

// The paths core takes from upstream: the kept skills' files and upstream's LICENSE.
export const upstreamKeep = (path: string): boolean =>
  path === "LICENSE" || UPSTREAM_SKILLS.includes(UPSTREAM_SKILL.exec(path)?.[1] ?? "")

// The core path an upstream file lands at: a skill flat under skills/, its category dropped, and LICENSE under upstream/, so MANIFEST and every staged path are relative to extensions/core/.
export const vendored = (files: UpstreamFile[]): UpstreamFile[] =>
  files.map(({ path, bytes }) => ({
    path: path === "LICENSE" ? "upstream/LICENSE" : path.replace(/^skills\/[^/]+\//, "skills/"),
    bytes,
  }))

// A git blob sha, the same value git stores for the bytes.
export const blobSha = (bytes: Uint8Array): string => {
  const hasher = new Bun.CryptoHasher("sha1")
  hasher.update(`blob ${bytes.byteLength}\0`)
  hasher.update(bytes)
  return hasher.digest("hex")
}

export const parseManifest = (text: string): ManifestEntry[] =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ sha: line.slice(0, 40), path: line.slice(41) }))

export const manifestText = (entries: ManifestEntry[]): string =>
  [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ sha, path }) => `${sha} ${path}`)
    .join("\n") + "\n"

export const manifestFor = (files: UpstreamFile[]): string =>
  manifestText(files.map(({ path, bytes }) => ({ path, sha: blobSha(bytes) })))

// The tree an extracted tarball holds, as paths relative to its root.
export const readTree = (dir: string): UpstreamFile[] => {
  const files: UpstreamFile[] = []
  const walk = (sub: string): void => {
    const entries = readdirSync(join(dir, sub), { withFileTypes: true })
      .map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const { name, dir: isDir } of entries) {
      const rel = sub ? `${sub}/${name}` : name
      if (isDir) walk(rel)
      else files.push({ path: rel, bytes: readFileSync(join(dir, rel)) })
    }
  }
  walk("")
  return files
}

// A GitHub codeload tarball sits in one folder named for the sha; strip it, so destDir is the repo root.
export const extractTarball = (tarPath: string, destDir: string): void => {
  mkdirSync(destDir, { recursive: true })
  const tar = Bun.spawnSync(["tar", "-xzf", tarPath, "-C", destDir, "--strip-components=1"], {
    stderr: "pipe",
  })
  if (tar.exitCode !== 0) throw new Error(`tar -xzf failed: ${tar.stderr.toString().trim()}`)
}

const SKILL = /^skills\/([^/]+)\/SKILL\.md$/

const skillsIn = (entries: ManifestEntry[]): Set<string> =>
  new Set(entries.flatMap(({ path }) => SKILL.exec(path)?.[1] ?? []))

// Each skill added or removed since the old MANIFEST; a skill is its SKILL.md folder.
export const diffSkills = (oldText: string | null, entries: ManifestEntry[]): string[] => {
  const was = skillsIn(oldText === null ? [] : parseManifest(oldText))
  const now = skillsIn(entries)
  return [
    ...[...now]
      .filter((name) => !was.has(name))
      .sort()
      .map((name) => `added: ${name}`),
    ...[...was]
      .filter((name) => !now.has(name))
      .sort()
      .map((name) => `removed: ${name}`),
  ]
}

const STAGING = ".upstream-staging"

// Stages the files in core, writes upstream/SOURCE and upstream/MANIFEST, and swaps each upstream skill folder and upstream/ in only when every staged byte matches its manifest sha; a skill's CREDITS.md, which is core's, stays, a skill the old MANIFEST held and the new one does not leaves, and a mismatch removes the staging folder and leaves core as it was. It never commits.
export const vendor = ({
  coreDir,
  files,
  manifest,
  repo,
  sha,
}: {
  coreDir: string
  files: UpstreamFile[]
  manifest: string
  repo: string
  sha: string
}): Vendored => {
  const entries = parseManifest(manifest)
  const bytesOf = new Map(files.map(({ path, bytes }) => [path, bytes]))
  const staging = join(coreDir, STAGING)
  rmSync(staging, { force: true, recursive: true })
  for (const { path } of entries) {
    const dest = join(staging, path)
    mkdirSync(dirname(dest), { recursive: true })
    const bytes = bytesOf.get(path)
    if (bytes === undefined)
      throw new Error(`vendor: MANIFEST names ${path}, which the downloaded tree does not hold`)
    writeFileSync(dest, bytes)
  }
  mkdirSync(join(staging, "upstream"), { recursive: true })
  writeFileSync(
    join(staging, "upstream", "SOURCE"),
    `${repo} ${sha}\n${new Date().toISOString().slice(0, 10)}\n`,
  )
  writeFileSync(join(staging, "upstream", "MANIFEST"), manifest)
  const mismatches = entries.flatMap(({ path, sha: wanted }) => {
    const got = blobSha(readFileSync(join(staging, path)))
    return got === wanted ? [] : [`${path}: staged ${got}, MANIFEST says ${wanted}`]
  })
  if (mismatches.length > 0) {
    rmSync(staging, { force: true, recursive: true })
    return { ok: false, mismatches }
  }
  const oldManifest = join(coreDir, "upstream", "MANIFEST")
  const was = existsSync(oldManifest)
    ? skillsIn(parseManifest(readFileSync(oldManifest, "utf8")))
    : new Set<string>()
  const now = skillsIn(entries)
  for (const name of new Set([...was, ...now])) {
    const live = join(coreDir, "skills", name)
    const credits = join(live, "CREDITS.md")
    const kept = existsSync(credits) ? readFileSync(credits) : null
    rmSync(live, { force: true, recursive: true })
    if (!now.has(name)) continue
    mkdirSync(dirname(live), { recursive: true })
    renameSync(join(staging, "skills", name), live)
    if (kept) writeFileSync(credits, kept)
  }
  rmSync(join(coreDir, "upstream"), { force: true, recursive: true })
  renameSync(join(staging, "upstream"), join(coreDir, "upstream"))
  rmSync(staging, { force: true, recursive: true })
  return { ok: true, files: entries.length }
}
