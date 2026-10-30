import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  blobSha,
  diffSkills,
  manifestFor,
  manifestText,
  parseManifest,
  readTree,
  upstreamKeep,
  vendored,
  vendor,
  type UpstreamFile,
} from "../../../../../packages/scripts/src/vendor-upstream/stage"

const bytes = (text: string) => new TextEncoder().encode(text)

// Upstream-shaped paths, the way the extracted tarball holds them: two kept skills, one skill core does not keep, a category README and the plugin manifest.
const UPSTREAM: UpstreamFile[] = [
  { path: ".claude-plugin/plugin.json", bytes: bytes('{"name":"skills"}\n') },
  { path: "LICENSE", bytes: bytes("MIT License\n") },
  { path: "skills/engineering/README.md", bytes: bytes("Engineering.\n") },
  { path: "skills/engineering/tdd/SKILL.md", bytes: bytes("---\nname: tdd\n---\n\nTdd.\n") },
  { path: "skills/engineering/triage/SKILL.md", bytes: bytes("---\nname: triage\n---\n") },
  {
    path: "skills/productivity/handoff/SKILL.md",
    bytes: bytes("---\nname: handoff\n---\n\nHandoff.\n"),
  },
]

const kept = (): UpstreamFile[] => vendored(UPSTREAM.filter(({ path }) => upstreamKeep(path)))

const put = (dir: string, path: string, data: Uint8Array): void => {
  const dest = join(dir, path)
  mkdirSync(join(dest, ".."), { recursive: true })
  writeFileSync(dest, data)
}

// A core folder the way a later run finds it: our own skill, a kept skill with its CREDITS, a skill the new MANIFEST drops, and the old upstream/ files.
const coreOf = (root: string): string => {
  const core = join(root, "extensions", "core")
  put(core, "skills/pr/SKILL.md", bytes("---\nname: pr\n---\n\nOurs.\n"))
  put(core, "skills/tdd/SKILL.md", bytes("old\n"))
  put(core, "skills/tdd/CREDITS.md", bytes("Our credits.\n"))
  put(core, "skills/research/SKILL.md", bytes("old\n"))
  put(
    core,
    "upstream/MANIFEST",
    bytes(`${"0".repeat(40)} skills/research/SKILL.md\n${"0".repeat(40)} skills/tdd/SKILL.md\n`),
  )
  put(core, "upstream/SOURCE", bytes("stub\n"))
  return core
}

const snapshot = (dir: string): string =>
  JSON.stringify(readTree(dir).map(({ path, bytes: data }) => [path, blobSha(data)]))

describe("blobSha", () => {
  test("matches the sha git stores for the same bytes", () => {
    expect(blobSha(bytes("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a")
    expect(blobSha(bytes("x"))).toBe("c1b0730e0133447badcfd47fd144e254807b06e1")
  })
})

describe("the manifest", () => {
  test("keeps the kept skills and LICENSE alone, flat under skills/ and upstream/, sorted by path", () => {
    expect(upstreamKeep("skills/engineering/tdd/SKILL.md")).toBe(true)
    expect(upstreamKeep("LICENSE")).toBe(true)
    expect(upstreamKeep("skills/engineering/triage/SKILL.md")).toBe(false)
    expect(upstreamKeep("skills/engineering/pr/SKILL.md")).toBe(false)
    expect(upstreamKeep(".claude-plugin/plugin.json")).toBe(false)
    expect(upstreamKeep("README.md")).toBe(false)
    const text = manifestFor([...kept()].reverse())
    expect(parseManifest(text).map(({ path }) => path)).toEqual([
      "skills/handoff/SKILL.md",
      "skills/tdd/SKILL.md",
      "upstream/LICENSE",
    ])
  })
})

describe("vendoring", () => {
  test("a matching tree swaps the kept skills in, keeps core's own files and CREDITS, and drops a skill no longer kept", () => {
    const root = mkdtempSync(join(tmpdir(), "vendor-upstream-test-"))
    try {
      const core = coreOf(root)
      const files = kept()
      const manifest = manifestFor(files)
      expect(
        vendor({ coreDir: core, files, manifest, repo: "upstream/skills", sha: "a".repeat(40) }),
      ).toEqual({
        ok: true,
        files: 3,
      })
      expect(
        readTree(core)
          .map(({ path }) => path)
          .sort(),
      ).toEqual([
        "skills/handoff/SKILL.md",
        "skills/pr/SKILL.md",
        "skills/tdd/CREDITS.md",
        "skills/tdd/SKILL.md",
        "upstream/LICENSE",
        "upstream/MANIFEST",
        "upstream/SOURCE",
      ])
      expect(readFileSync(join(core, "skills/tdd/SKILL.md"), "utf8")).toBe(
        "---\nname: tdd\n---\n\nTdd.\n",
      )
      expect(readFileSync(join(core, "skills/tdd/CREDITS.md"), "utf8")).toBe("Our credits.\n")
      expect(readFileSync(join(core, "upstream/MANIFEST"), "utf8")).toBe(manifest)
      expect(readFileSync(join(core, "upstream/SOURCE"), "utf8")).toBe(
        `upstream/skills ${"a".repeat(40)}\n${new Date().toISOString().slice(0, 10)}\n`,
      )
      expect(existsSync(join(core, ".upstream-staging"))).toBe(false)
      // A second run over the same sha swaps the same bytes in again.
      expect(
        vendor({ coreDir: core, files, manifest, repo: "upstream/skills", sha: "a".repeat(40) }),
      ).toEqual({
        ok: true,
        files: 3,
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test("one changed byte fails and leaves core as it was", () => {
    const root = mkdtempSync(join(tmpdir(), "vendor-upstream-test-"))
    try {
      const core = coreOf(root)
      const before = snapshot(core)
      const entries = parseManifest(manifestFor(kept()))
      const first = entries[0]!
      const real = first.sha
      first.sha = (first.sha.startsWith("a") ? "b" : "a") + first.sha.slice(1)
      const done = vendor({
        coreDir: core,
        files: kept(),
        manifest: manifestText(entries),
        repo: "upstream/skills",
        sha: "a".repeat(40),
      })
      expect(done.ok).toBe(false)
      if (!done.ok)
        expect(done.mismatches).toEqual([
          `${first.path}: staged ${real}, MANIFEST says ${first.sha}`,
        ])
      expect(snapshot(core)).toBe(before)
      expect(existsSync(join(core, ".upstream-staging"))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})

describe("the skill diff", () => {
  test("names each skill added or removed", () => {
    const old = manifestText([
      { sha: "0".repeat(40), path: "skills/alpha/SKILL.md" },
      { sha: "0".repeat(40), path: "skills/gamma/SKILL.md" },
    ])
    const now = parseManifest(
      manifestText([
        { sha: "0".repeat(40), path: "skills/alpha/SKILL.md" },
        { sha: "0".repeat(40), path: "skills/delta/SKILL.md" },
        { sha: "0".repeat(40), path: "upstream/LICENSE" },
      ]),
    )
    expect(diffSkills(old, now)).toEqual(["added: delta", "removed: gamma"])
  })

  test("a first run reads every skill as added", () => {
    const now = parseManifest(manifestText([{ sha: "0".repeat(40), path: "skills/beta/SKILL.md" }]))
    expect(diffSkills(null, now)).toEqual(["added: beta"])
  })
})
