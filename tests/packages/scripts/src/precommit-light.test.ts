import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CHECKS, checksFor, precommitLight } from "../../../../packages/scripts/src/precommit-light"

const ROOT = join(import.meta.dir, "../../../..")
const DIR = mkdtempSync(join(tmpdir(), "precommit-light-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const runner = (failing: string[]) => {
  const ran: string[] = []
  const run = async (argv: string[]) => {
    const name = argv[1] === "commitlint" ? "commitlint" : CHECKS.find((c) => c.argv === argv)?.name
    if (!name) throw new Error(`not a check: ${argv.join(" ")}`)
    ran.push(name)
    return failing.includes(name) ? 1 : 0
  }
  return { ran, run }
}

const NAMES = ["conflict-markers", "docs-wrap", "em-dashes", "env-keys", "trace-count"]

describe("precommit:light", () => {
  test("the root script runs precommit-light.ts", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json()
    expect(pkg.scripts["precommit:light"]).toBe("bun packages/scripts/src/precommit-light.ts")
  })

  test("it holds conflict-markers, docs-wrap, em-dashes, env-keys and trace-count", () => {
    expect(CHECKS.map((c) => c.name)).toEqual(NAMES)
  })

  test("conflict-markers, docs-wrap, env-keys and trace-count run as lefthook's pre-commit runs them", async () => {
    const hooks = await Bun.file(join(ROOT, "lefthook.yml")).text()
    for (const name of ["conflict-markers", "docs-wrap", "trace-count"]) {
      const check = CHECKS.find((c) => c.name === name)!
      expect(hooks).toContain(`run: ${check.argv.join(" ")}\n`)
    }
    const envKeys = CHECKS.find((c) => c.name === "env-keys")!.argv
    expect(envKeys.slice(0, 2)).toEqual(["bash", "-c"])
    expect(hooks).toContain(`run: ${envKeys[2]}\n`)
  })

  test("em-dashes runs the repo's em-dash check", () => {
    expect(CHECKS.find((c) => c.name === "em-dashes")!.argv).toEqual([
      "bash",
      "scripts/check-em-dashes.sh",
    ])
  })

  test("all five pass: exit 0", async () => {
    const { ran, run } = runner([])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l))).toBe(0)
    expect(ran).toEqual(NAMES)
    expect(lines).toEqual(["precommit:light: all passed"])
  })

  test.each(NAMES)("%s fails: exit 1, and every check still runs", async (name) => {
    const { ran, run } = runner([name])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l))).toBe(1)
    expect(ran).toEqual(NAMES)
    expect(lines).toEqual([`precommit:light: failed: ${name}`])
  })

  test("a message file adds commitlint, as lefthook's commit-msg step runs it", async () => {
    const hooks = await Bun.file(join(ROOT, "lefthook.yml")).text()
    expect(hooks).toContain("run: bunx commitlint --edit {1}\n")
    expect(checksFor("msg.txt").at(-1)).toEqual({
      argv: ["bunx", "commitlint", "--edit", "msg.txt"],
      name: "commitlint",
    })
    expect(checksFor()).toEqual(CHECKS)
  })

  test("commitlint fails: exit 1, and the other five still run", async () => {
    const { ran, run } = runner(["commitlint"])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l), "msg.txt")).toBe(1)
    expect(ran).toEqual([...NAMES, "commitlint"])
    expect(lines).toEqual(["precommit:light: failed: commitlint"])
  })

  test.each([
    ["Feat: a capitalised type", 1],
    [`feat: ${"a".repeat(101)}`, 1],
    ["feat: a header commitlint takes", 0],
  ])("the commitlint argv run for real on %p exits %p", async (header, code) => {
    const file = join(DIR, `${code}-${header.length}.txt`)
    await Bun.write(file, `${header}\n`)
    const argv = checksFor(file).at(-1)!.argv
    const exit = await Bun.spawn(argv, { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] }).exited
    expect(exit === 0 ? 0 : 1).toBe(code)
  })

  // the shape a commit made with hooks off once carried: git's own conflict block, staged in a generated hook bundle
  test("the conflict-markers argv run for real refuses a staged conflict block in a hook bundle", async () => {
    const argv = CHECKS.find((c) => c.name === "conflict-markers")!.argv
    const repo = join(DIR, "markers")
    mkdirSync(join(repo, "scripts/hooks/bundled"), { recursive: true })
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined && !entry[0].startsWith("GIT_"),
        ),
      ),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    }
    const run = (args: string[]) =>
      Bun.spawnSync(args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] })
    expect(run(["git", "init", "-q"]).exitCode).toBe(0)
    const stageAndCheck = async (text: string) => {
      await Bun.write(join(repo, "scripts/hooks/bundled/guard.js"), text)
      expect(run(["git", "add", "-A"]).exitCode).toBe(0)
      const check = run(argv.map((arg) => (arg.startsWith("packages/") ? join(ROOT, arg) : arg)))
      return { code: check.exitCode, out: check.stderr.toString() }
    }
    const refused = await stageAndCheck("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> origin/canary\n")
    expect(refused.code).toBe(1)
    expect(refused.out).toContain(
      "scripts/hooks/bundled/guard.js:2, scripts/hooks/bundled/guard.js:6",
    )
    expect(await stageAndCheck("a\nb\nc\n")).toEqual({ code: 0, out: "" })
  })

  test("two fail: both are named", async () => {
    const { run } = runner(["docs-wrap", "trace-count"])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l))).toBe(1)
    expect(lines).toEqual(["precommit:light: failed: docs-wrap, trace-count"])
  })
})
