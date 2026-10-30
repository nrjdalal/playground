import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TRY_MS, fakeBun, lockOf } from "./audit-fake"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/audit.ts")
const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// a fake `bun` on PATH answers each `bun audit` try by the plan's next line: 503, advisory, crash, hang or ok
const bin = mkdtempSync(join(tmpdir(), "audit-bin-"))
dirs.push(bin)
writeFileSync(
  join(bin, "bun"),
  `#!/bin/sh
echo "$*" >> "$AUDIT_PLAN/tries"
case $(sed -n "$(wc -l < "$AUDIT_PLAN/tries")p" "$AUDIT_PLAN/plan") in
  503) echo "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503" >&2; exit 1 ;;
  advisory) echo "1 high"; exit 1 ;;
  hang) exec /bin/sleep 30 ;;
  crash) kill -SEGV $$ ;;
  *) echo "No vulnerabilities found" ;;
esac
`,
)
chmodSync(join(bin, "bun"), 0o755)
// a new executable's first run waits about 0.5s alone and past 3s beside the suite, so the fake takes that run here, outside every try's limit
Bun.spawnSync([join(bin, "bun")], { env: { AUDIT_PLAN: bin, PATH: "/usr/bin:/bin" } })

const run = (plan: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"))
  dirs.push(dir)
  writeFileSync(join(dir, "plan"), `${plan.join("\n")}\n`)
  const proc = Bun.spawnSync([process.execPath, SCRIPT, "--audit-level", "high"], {
    env: { AUDIT_PLAN: dir, AUDIT_TRY_MS: TRY_MS, PATH: `${bin}:/usr/bin:/bin` },
  })
  return {
    code: proc.exitCode,
    err: proc.stderr.toString(),
    tries: readFileSync(join(dir, "tries"), "utf8").trim().split("\n"),
  }
}

describe("audit", () => {
  test("a 503 from the advisories endpoint goes again, and the next try's pass is the run's", () => {
    const { code, err, tries } = run(["503", "ok"])
    expect(code).toBe(0)
    expect(tries).toEqual(["audit --audit-level high", "audit --audit-level high"])
    expect(err).toContain("try 1 of 3: npm's advisories endpoint answered 5xx, trying again")
  })

  test("a try that runs out its limit goes again", () => {
    const { code, tries } = run(["hang", "ok"])
    expect(code).toBe(0)
    expect(tries).toHaveLength(2)
  })

  test("an advisory fails on the first try, with no retry", () => {
    const { code, tries } = run(["advisory", "ok"])
    expect(code).toBe(1)
    expect(tries).toHaveLength(1)
  })

  test("a crash fails on the first try, though it too ends the try by a signal", () => {
    const { code, tries } = run(["crash", "ok"])
    expect(code).not.toBe(0)
    expect(tries).toHaveLength(1)
  })

  test("3 tries with no answer fail the run", () => {
    const { code, err, tries } = run(["503", "hang", "503", "ok"])
    expect(code).toBe(1)
    expect(tries).toHaveLength(3)
    expect(err).toContain("npm's advisories endpoint answered 5xx on all 3 tries")
  })
})

const over = (head: string, base: string, env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "audit-over-"))
  dirs.push(dir)
  fakeBun(dir)
  const work = join(dir, "work")
  mkdirSync(work)
  writeFileSync(join(work, "bun.lock"), head)
  writeFileSync(join(dir, "base.lock"), base)
  const proc = Bun.spawnSync(
    [
      process.execPath,
      SCRIPT,
      "--audit-level",
      "high",
      "--ignore",
      "GHSA-ignored",
      "--new-over",
      join(dir, "base.lock"),
    ],
    {
      cwd: work,
      env: { AUDIT_TRY_MS: TRY_MS, PATH: `${dir}:/usr/bin:/bin`, ...env },
    },
  )
  return {
    code: proc.exitCode,
    err: proc.stderr.toString(),
    out: proc.stdout.toString(),
    tries: readFileSync(join(dir, "tries"), "utf8").trim().split("\n"),
  }
}

const CANARY: [string, string, string][] = [
  ["dompurify", "GHSA-cg2g-xh64-v4q7", "critical"],
  ["toml", "GHSA-toml-high", "high"],
]

describe("audit --new-over (#1704)", () => {
  test("a head that adds nothing passes while canary carries dompurify and toml, and names them as canary's", () => {
    const { code, out } = over(lockOf(...CANARY), lockOf(...CANARY))
    expect(code).toBe(0)
    expect(out).toContain("already carries 2")
    expect(out).toContain("GHSA-cg2g-xh64-v4q7 (dompurify, critical)")
    expect(out).toContain("this head adds no advisory")
  })

  test("a head whose lockfile adds an advisory fails, naming it and only it", () => {
    const { code, err } = over(
      lockOf(...CANARY, ["lodash", "GHSA-new-one", "high"]),
      lockOf(...CANARY),
    )
    expect(code).toBe(1)
    expect(err).toContain("this head adds 1")
    expect(err).toContain("GHSA-new-one (lodash, high)")
    expect(err).not.toContain("dompurify")
  })

  test("an added advisory below the level, or one --ignore names, passes", () => {
    const head = lockOf(["a", "GHSA-low-one", "moderate"], ["braces", "GHSA-ignored", "high"])
    expect(over(head, lockOf()).code).toBe(0)
  })

  test("a 5xx on either audit goes again, and the retry's answer is the run's", () => {
    const { code, err, tries } = over(lockOf(...CANARY), lockOf(...CANARY), {
      FAKE_503: "1",
    })
    expect(code).toBe(0)
    expect(tries).toHaveLength(4)
    expect(err).toContain("npm's advisories endpoint answered 5xx, trying again")
  })

  test("a ref reads the lockfile at HEAD's merge base with it, so canary's later commits count for nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-git-"))
    dirs.push(dir)
    fakeBun(dir)
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir })
    const commit = (lock: string) => {
      writeFileSync(join(dir, "bun.lock"), lock)
      git("add", "bun.lock")
      git("commit", "-qm", "lock")
    }
    git("init", "-q", "-b", "canary")
    commit(lockOf(...CANARY))
    git("checkout", "-qb", "pr")
    commit(lockOf(...CANARY, ["lodash", "GHSA-new-one", "high"]))
    git("checkout", "-q", "canary")
    commit(lockOf(...CANARY, ["lodash", "GHSA-new-one", "high"], ["later", "GHSA-later", "high"]))
    git("checkout", "-q", "pr")
    const proc = Bun.spawnSync(
      [process.execPath, SCRIPT, "--audit-level", "high", "--new-over", "canary"],
      {
        cwd: dir,
        env: { AUDIT_TRY_MS: TRY_MS, PATH: `${dir}:/usr/bin:/bin` },
      },
    )
    expect(proc.exitCode).toBe(1)
    expect(proc.stderr.toString()).toContain("GHSA-new-one (lodash, high)")
  })
})
