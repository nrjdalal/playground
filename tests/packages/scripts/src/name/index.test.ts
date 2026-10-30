import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ID_ALPHABET, ROSTER_KINDS } from "../../../../../packages/config/src/kinds"

const SCRIPT = join(import.meta.dir, "../../../../../packages/scripts/src/name/index.ts")

// Each case reads its own empty Claude config folder.
const configs: string[] = []
const config = () => {
  const dir = mkdtempSync(join(tmpdir(), "name-config-"))
  configs.push(dir)
  return dir
}
const run = (dir: string, args: string[]) => {
  const read = Bun.spawnSync(["bun", SCRIPT, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  })
  return {
    code: read.exitCode,
    err: read.stderr.toString().trim(),
    out: read.stdout.toString().trim(),
  }
}
afterAll(() => {
  for (const dir of configs) rmSync(dir, { force: true, recursive: true })
})
describe("bun run name", () => {
  test.each([...ROSTER_KINDS])("prints <id>-%s, a 6-letter id from the alphabet", (kind) => {
    const { code, err, out } = run(config(), [kind])
    expect({ code, err }).toEqual({ code: 0, err: "" })
    expect(out).toMatch(new RegExp(`^[${ID_ALPHABET}]{6}-${kind}$`))
  })

  test("two runs print two ids", () => {
    const dir = config()
    expect(run(dir, ["worker"]).out).not.toBe(run(dir, ["worker"]).out)
  })

  test("refuses a kind off the list, no kind, and a second word", () => {
    const usage = `usage: bun run name <kind>, a kind of ${ROSTER_KINDS.join(", ")}`
    for (const args of [["lead"], [], ["reviewer", "--worker", "worker-brave-otter"]]) {
      expect(run(config(), args)).toEqual({ code: 1, err: usage, out: "" })
    }
  })
})
