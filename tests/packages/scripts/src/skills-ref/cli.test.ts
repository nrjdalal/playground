import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { specOnly } from "../../../../../packages/scripts/src/skills-ref/cli"

const SCRIPT = join(import.meta.dir, "../../../../../packages/scripts/src/skills-ref/cli.ts")
const ROOT = mkdtempSync(join(tmpdir(), "skills-ref-test-"))
afterAll(() => rmSync(ROOT, { force: true, recursive: true }))

const SKILL = [
  "---",
  "name: tidy",
  "description: Tidy a folder.",
  "disable-model-invocation: true",
  "hooks:",
  "  Stop:",
  "    - command: echo done",
  "license: Complete terms in NOTICE",
  "source: upstream",
  "---",
  "",
  "# Tidy",
  "",
].join("\n")

describe("the skills-ref step's copy", () => {
  test("drops each Claude Code key with the lines nested under it, and keeps every other key", () => {
    expect(specOnly(SKILL)).toBe(
      [
        "---",
        "name: tidy",
        "description: Tidy a folder.",
        "license: Complete terms in NOTICE",
        "source: upstream",
        "---",
        "",
        "# Tidy",
        "",
      ].join("\n"),
    )
  })

  test("drops the upstream keys only in the zerostarter bucket, so a core or org skill holding one still fails", () => {
    expect(specOnly(SKILL, "skills/zerostarter/tidy/SKILL.md")).not.toContain("source:")
    expect(specOnly(SKILL, "skills/playground/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/core/skills/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/acme/skills/tidy/SKILL.md")).toContain("source: upstream")
  })

  test("leaves a file with no frontmatter as it is", () => {
    expect(specOnly("# Tidy\n")).toBe("# Tidy\n")
  })
})

// a fake uv on PATH passes every copy and leaves a marked file once it meets makeScratch's marker in the copies' folder
test("the copies' folder is a marked scratch folder, gone once the run ends (#545)", () => {
  const bin = join(ROOT, "bin")
  const tmp = join(ROOT, "tmp")
  mkdirSync(bin)
  mkdirSync(tmp)
  writeFileSync(
    join(bin, "uv"),
    `#!/bin/sh\nfor f in "$TMPDIR"/skills-ref-*/.safe-delete-scratch; do [ -f "$f" ] && : > "${ROOT}/marked"; done\nexit 0\n`,
  )
  chmodSync(join(bin, "uv"), 0o755)
  const run = Bun.spawnSync([process.execPath, SCRIPT], {
    env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: tmp },
    stderr: "pipe",
    stdout: "pipe",
  })
  expect(run.stdout.toString()).toContain("skills pass skills-ref validate")
  expect(run.exitCode).toBe(0)
  expect(existsSync(join(ROOT, "marked"))).toBe(true)
  expect(readdirSync(tmp)).toEqual([])
})

// A fake uv that logs each call and answers as uv 0.13.7 did, measured against an index that never answers: online, exit 2 and its timeout lines; offline, exit 0 from a warm cache, or exit 1 and its no-solution lines from an empty one
const TIMED_OUT = [
  "error: Request failed after 3 retries in 19.3s",
  "  cause: Failed to fetch: https://pypi.org/simple/click/",
  "  cause: error sending request for url (https://pypi.org/simple/click/)",
  "  cause: operation timed out",
].join("\n")
const NOT_CACHED = [
  "error: No solution found when resolving `--with` dependencies",
  "  cause: Because click was not found in the cache and skills-ref==0.1.0 depends on click>=8.0, we can conclude that skills-ref==0.1.0 cannot be used.",
  "",
  "hint: Packages were unavailable because the network was disabled. When the network is disabled, registry packages may only be read from the cache.",
].join("\n")
const fakeUv = (index: "up" | "down", cache: "warm" | "empty") => {
  const dir = mkdtempSync(join(ROOT, "uv-"))
  mkdirSync(join(dir, "bin"))
  mkdirSync(join(dir, "tmp"))
  const calls = join(dir, "calls")
  writeFileSync(join(dir, "timed-out"), TIMED_OUT)
  writeFileSync(join(dir, "not-cached"), NOT_CACHED)
  writeFileSync(
    join(dir, "bin", "uv"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${calls}"`,
      'case " $* " in *" --offline "*)',
      cache === "empty" ? `  cat "${dir}/not-cached" >&2; exit 1;;` : "  exit 0;;",
      "esac",
      index === "down" ? `cat "${dir}/timed-out" >&2; exit 2` : "exit 0",
      "",
    ].join("\n"),
  )
  chmodSync(join(dir, "bin", "uv"), 0o755)
  const run = Bun.spawnSync([process.execPath, SCRIPT], {
    env: { PATH: `${join(dir, "bin")}:/usr/bin:/bin`, TMPDIR: join(dir, "tmp") },
    stderr: "pipe",
    stdout: "pipe",
  })
  const log = existsSync(calls) ? readFileSync(calls, "utf8") : ""
  return { log, run }
}
const online = (log: string) => log.split("\n").filter((l) => l && !l.includes("--offline"))

describe("skills-ref validate's package index (#990)", () => {
  test("makes one index fetch over every skill, and validates each from uv's cache", () => {
    const { log, run } = fakeUv("up", "warm")
    expect(run.exitCode).toBe(0)
    expect(online(log)).toHaveLength(1)
    expect(log.split("\n").filter((l) => l.includes(" validate /")).length).toBeGreaterThan(1)
  })

  test("passes from uv's cache when the index times out", () => {
    const { log, run } = fakeUv("down", "warm")
    expect(run.stdout.toString()).toContain("skills pass skills-ref validate")
    expect(run.stdout.toString()).not.toContain("FAIL")
    expect(run.exitCode).toBe(0)
    expect(online(log)).toHaveLength(1)
  })

  test("fails naming the index when the index times out and uv's cache is empty", () => {
    const { run } = fakeUv("down", "empty")
    expect(run.exitCode).toBe(1)
    expect(run.stdout.toString()).toContain("neither on the package index nor in its cache")
    expect(run.stdout.toString()).toContain("Failed to fetch: https://pypi.org/simple/click/")
  })
})
