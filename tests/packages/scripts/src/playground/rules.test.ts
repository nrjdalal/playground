import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HELP } from "../../../../../packages/scripts/src/playground/plan"
import { runRules } from "../../../../../packages/scripts/src/playground/rules"

const run = async (args: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const env = { PLAYGROUND_DATA_DIR: mkdtempSync(join(tmpdir(), "rules-verb-")) }
  const code = await runRules(
    args,
    "/nowhere",
    env,
    (t) => out.push(t),
    (t) => err.push(t),
  )
  return { code, err: err.join("\n"), out: out.join("\n") }
}

describe("playground rules", () => {
  test("with no name it lists every rule's glance, as a session starts with them", async () => {
    const { code, out } = await run([])
    expect(code).toBe(0)
    expect(out).toContain("`playground rules <name>`")
    expect(out).toContain("- **glm**: ")
  })

  test("a name prints that rule whole, a hyphen read as a space", async () => {
    const { code, out } = await run(["glm"])
    expect(code).toBe(0)
    expect(out.startsWith("**glm**\n\n")).toBe(true)
    expect(out).toContain("over 15")
    expect((await run(["no-such-rule"])).err).toContain("no rule named no such rule")
  })

  test("a name no scope holds exits 1, and two names exit 2 with the usage", async () => {
    expect((await run(["no-such-rule"])).code).toBe(1)
    const two = await run(["a", "b"])
    expect(two.code).toBe(2)
    expect(two.err).toBe("usage: playground rules [<name>]")
  })

  test("--help names the command", () => {
    expect(HELP).toContain("playground rules [<name>]")
  })
})
