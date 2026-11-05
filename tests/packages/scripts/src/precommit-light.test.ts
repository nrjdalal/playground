import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { CHECKS, precommitLight } from "../../../../packages/scripts/src/precommit-light"

const ROOT = join(import.meta.dir, "../../../..")

const runner = (failing: string[]) => {
  const ran: string[] = []
  const run = async (argv: string[]) => {
    const check = CHECKS.find((c) => c.argv === argv)
    if (!check) throw new Error(`not a check: ${argv.join(" ")}`)
    ran.push(check.name)
    return failing.includes(check.name) ? 1 : 0
  }
  return { ran, run }
}

describe("precommit:light", () => {
  test("the root script runs precommit-light.ts", async () => {
    const pkg = await Bun.file(join(ROOT, "package.json")).json()
    expect(pkg.scripts["precommit:light"]).toBe("bun packages/scripts/src/precommit-light.ts")
  })

  test("it holds docs-wrap, em-dashes, env-keys and trace-count", () => {
    expect(CHECKS.map((c) => c.name)).toEqual(["docs-wrap", "em-dashes", "env-keys", "trace-count"])
  })

  test("docs-wrap, env-keys and trace-count run as lefthook's pre-commit runs them", async () => {
    const hooks = await Bun.file(join(ROOT, "lefthook.yml")).text()
    for (const name of ["docs-wrap", "trace-count"]) {
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

  test("all four pass: exit 0", async () => {
    const { ran, run } = runner([])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l))).toBe(0)
    expect(ran).toEqual(["docs-wrap", "em-dashes", "env-keys", "trace-count"])
    expect(lines).toEqual(["precommit:light: all passed"])
  })

  test.each(["docs-wrap", "em-dashes", "env-keys", "trace-count"])(
    "%s fails: exit 1, and every check still runs",
    async (name) => {
      const { ran, run } = runner([name])
      const lines: string[] = []
      expect(await precommitLight(run, (l) => lines.push(l))).toBe(1)
      expect(ran).toEqual(["docs-wrap", "em-dashes", "env-keys", "trace-count"])
      expect(lines).toEqual([`precommit:light: failed: ${name}`])
    },
  )

  test("two fail: both are named", async () => {
    const { run } = runner(["docs-wrap", "trace-count"])
    const lines: string[] = []
    expect(await precommitLight(run, (l) => lines.push(l))).toBe(1)
    expect(lines).toEqual(["precommit:light: failed: docs-wrap, trace-count"])
  })
})
