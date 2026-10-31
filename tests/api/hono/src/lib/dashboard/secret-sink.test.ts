import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runSink, spawnSink } from "../../../../../../api/hono/src/lib/dashboard/secret-sink"

const scratch = mkdtempSync(join(tmpdir(), "secret-sink-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const VALUE = `made-up-secret-${crypto.randomUUID()}`

// A stand-in for vercel: it writes the argv it was given and the stdin it read into files, then exits with the code its first argument names.
const STUB = join(scratch, "stub.ts")
await Bun.write(
  STUB,
  `const [out, code] = process.argv.slice(2)
await Bun.write(out + ".argv", JSON.stringify(process.argv))
await Bun.write(out + ".stdin", await Bun.stdin.text())
process.exit(Number(code))
`,
)

describe("the secret's sink process (PG-59)", () => {
  test("reads the value on its stdin, never in its argv, and its exit code comes back", async () => {
    const out = join(scratch, "one")
    expect(await spawnSink([process.execPath, STUB, out, "3"], VALUE)).toBe(3)
    expect(await Bun.file(`${out}.stdin`).text()).toBe(VALUE)
    expect(await Bun.file(`${out}.argv`).text()).not.toContain(VALUE)
  })

  test("one that cannot start reads 127, and one past its time is stopped and reads null", async () => {
    expect(await spawnSink([join(scratch, "no-such-binary")], VALUE)).toBe(127)
    expect(
      await spawnSink([process.execPath, "-e", "await Bun.sleep(10_000)"], VALUE, 200),
    ).toBeNull()
  })

  test("a stack that does not read the live machine runs no process and reads 0", async () => {
    const out = join(scratch, "fixture")
    expect(await runSink([process.execPath, STUB, out, "1"], VALUE)).toBe(0)
    expect(existsSync(`${out}.stdin`)).toBe(false)
  })
})
