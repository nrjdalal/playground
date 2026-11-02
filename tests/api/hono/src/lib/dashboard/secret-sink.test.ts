import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type SecretSink, sinkSteps } from "../../../../../../api/hono/src/lib/dashboard/inbox"
import {
  runSink,
  sinkEnv,
  spawnSink,
} from "../../../../../../api/hono/src/lib/dashboard/secret-sink"

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
    expect(await spawnSink([process.execPath, STUB, out, "3"], VALUE, "vercel")).toBe(3)
    expect(await Bun.file(`${out}.stdin`).text()).toBe(VALUE)
    expect(await Bun.file(`${out}.argv`).text()).not.toContain(VALUE)
  })

  test("one that cannot start reads 127, and one past its time is stopped and reads null", async () => {
    expect(await spawnSink([join(scratch, "no-such-binary")], VALUE, "vercel")).toBe(127)
    expect(
      await spawnSink([process.execPath, "-e", "await Bun.sleep(10_000)"], VALUE, "vercel", 200),
    ).toBeNull()
  })

  test("a stack that does not read the live machine runs no process and reads 0", async () => {
    const out = join(scratch, "fixture")
    expect(await runSink([process.execPath, STUB, out, "1"], VALUE, "vercel")).toBe(0)
    expect(await Bun.file(`${out}.stdin`).exists()).toBe(false)
  })

  test("gets only what vercel needs from the API's environment, never its secrets", () => {
    const env = sinkEnv("vercel", {
      BETTER_AUTH_SECRET: "made-up-auth",
      HOME: "/home/made-up",
      PATH: "/usr/bin",
      POSTGRES_URL: "postgres://made-up",
      VERCEL_TOKEN: "made-up-token",
    })
    expect(env).toEqual({ HOME: "/home/made-up", PATH: "/usr/bin", VERCEL_TOKEN: "made-up-token" })
  })

  test("gets only what op needs to find its sign-in, never the API's secrets or Vercel's", () => {
    const env = sinkEnv("1password", {
      BETTER_AUTH_SECRET: "made-up-auth",
      HOME: "/home/made-up",
      OP_ACCOUNT: "made-up-account",
      OP_CONFIG_DIR: "/home/made-up/op",
      PATH: "/usr/bin",
      POSTGRES_URL: "postgres://made-up",
      VERCEL_TOKEN: "made-up-token",
      XDG_CONFIG_HOME: "/home/made-up/.config",
    })
    expect(env).toEqual({
      HOME: "/home/made-up",
      OP_ACCOUNT: "made-up-account",
      OP_CONFIG_DIR: "/home/made-up/op",
      PATH: "/usr/bin",
      XDG_CONFIG_HOME: "/home/made-up/.config",
    })
  })
})

// A stand-in for op on a PATH of its own, so no real op is ever reached: it records its argv, its stdin and its environment's names, then exits with the code OP_FAKE_EXITS gives its first word.
describe("the 1Password sink against a fake op", () => {
  const bin = join(scratch, "bin")
  const record = join(scratch, "record")
  const none = join(scratch, "none")
  for (const dir of [bin, record, none]) mkdirSync(dir)
  const fake = join(bin, "op")
  const written = Bun.write(
    fake,
    `#!${process.execPath}
const word = process.argv[2]
const dir = process.env.OP_FAKE_RECORD
await Bun.write(dir + "/" + word + ".argv", JSON.stringify(process.argv.slice(2)))
await Bun.write(dir + "/" + word + ".stdin", await Bun.stdin.text())
await Bun.write(dir + "/" + word + ".env", JSON.stringify(Object.keys(process.env)))
if (process.env.OP_FAKE_SLEEP === word) await Bun.sleep(10_000)
process.exit(Number(JSON.parse(process.env.OP_FAKE_EXITS ?? "{}")[word] ?? 0))
`,
  )
  const place = { tag: "made-up-tag", vault: "Made Up Vault" }
  const steps = sinkSteps(
    "made-up.service.token",
    { type: "1password" } as SecretSink,
    VALUE,
    place,
  )

  // runs the sink's steps as provideSecret does, stopping at the first that fails, with the API's environment set to env for the run
  const runSteps = async (env: Record<string, string>, timeout?: number) => {
    await written
    chmodSync(fake, 0o755)
    const saved = { ...process.env }
    Object.assign(process.env, { BETTER_AUTH_SECRET: "made-up-auth", OP_FAKE_RECORD: record }, env)
    const codes: (number | null)[] = []
    try {
      for (const step of steps) {
        const code = await spawnSink(step.argv, step.stdin, "1password", timeout)
        codes.push(code)
        if (code !== 0) break
      }
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
    return codes
  }
  const read = (name: string) => Bun.file(join(record, name)).text()

  test("runs op with the value inside its stdin alone, never in its argv, and with only op's environment", async () => {
    expect(await runSteps({ PATH: bin })).toEqual([0, 0])
    expect(JSON.parse(await read("signin.argv"))).toEqual(["signin"])
    expect(JSON.parse(await read("item.argv"))).toEqual([
      "item",
      "create",
      "--vault",
      "Made Up Vault",
      "--tags",
      "made-up-tag",
      "-",
    ])
    expect(await read("item.argv")).not.toContain(VALUE)
    expect(JSON.parse(await read("item.stdin")).fields[0].value).toBe(VALUE)
    const env: string[] = JSON.parse(await read("item.env"))
    expect(env).toContain("OP_FAKE_RECORD")
    expect(env).not.toContain("BETTER_AUTH_SECRET")
  })

  test("an op that is missing reads 127, a refused sign-in its own exit, and either stops the item", async () => {
    expect(await runSteps({ PATH: none })).toEqual([127])
    rmSync(join(record, "item.argv"), { force: true })
    expect(await runSteps({ OP_FAKE_EXITS: '{"signin":1}', PATH: bin })).toEqual([1])
    expect(await Bun.file(join(record, "item.argv")).exists()).toBe(false)
    expect(await runSteps({ OP_FAKE_EXITS: '{"item":2}', PATH: bin })).toEqual([0, 2])
  })

  test("an op past its time limit is stopped and reads null", async () => {
    expect(await runSteps({ OP_FAKE_SLEEP: "signin", PATH: bin }, 300)).toEqual([null])
  })
})
