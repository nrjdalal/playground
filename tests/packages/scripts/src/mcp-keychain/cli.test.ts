import { afterAll, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scratchEnv } from "../../../../scratch-env"

const CLI = join(import.meta.dir, "../../../../../packages/scripts/src/mcp-keychain/cli.ts")
const TOKEN = "made-up-token-0123456789"

// A fake security first on PATH that holds one made-up item, and a child that reports what it got as facts, never the token itself.
const dir = mkdtempSync(join(tmpdir(), "mcp-keychain-"))
writeFileSync(
  join(dir, "security"),
  `#!/bin/sh
[ "$*" = "find-generic-password -s made-up-service -a made-up-account -w" ] && { echo "${TOKEN}"; exit 0; }
[ "$*" = "find-generic-password -s made-up-service -a empty-account -w" ] && { echo; exit 0; }
exit 44
`,
)
chmodSync(join(dir, "security"), 0o755)
const child = join(dir, "child.ts")
writeFileSync(
  child,
  `const token = ${JSON.stringify(TOKEN)}
await Bun.write(process.env.REPORT, JSON.stringify({
  inEnv: process.env.MADE_UP_KEY === token,
  inArgv: process.argv.some((a) => a.includes(token)),
}))
process.stdout.write("got " + (await Bun.stdin.text()))
process.exit(Number(process.argv[2]))
`,
)
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const launch = (account: string, report: string) =>
  Bun.spawnSync(
    [
      "bun",
      "--no-env-file",
      CLI,
      "made-up-service",
      account,
      "MADE_UP_KEY",
      "--",
      "bun",
      child,
      "7",
    ],
    {
      env: scratchEnv(dir, { PATH: `${dir}:${process.env.PATH}`, REPORT: report }),
      stdin: new Blob(["a request"]),
    },
  )

test("the token reaches the child's env under the named key, and no argv, output or exit code of its own", () => {
  const report = join(dir, "found.json")
  const run = launch("made-up-account", report)
  const got = JSON.parse(readFileSync(report, "utf8"))
  expect(got).toEqual({ inArgv: false, inEnv: true })
  expect(run.stdout.toString()).toBe("got a request")
  expect(run.stdout.toString() + run.stderr.toString()).not.toContain(TOKEN)
  expect(run.exitCode).toBe(7)
})

test("a missing item exits 1 naming its service and account, and starts no child", () => {
  const report = join(dir, "missing.json")
  const run = launch("gone-account", report)
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toContain("made-up-service")
  expect(run.stderr.toString()).toContain("gone-account")
  expect(existsSync(report)).toBe(false)
})

test("an empty item exits 1 naming its account, and starts no child", () => {
  const report = join(dir, "empty.json")
  const run = launch("empty-account", report)
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toContain("empty-account")
  expect(existsSync(report)).toBe(false)
})

test("a call with no command after -- exits 2 with its usage, reading no item", () => {
  const run = Bun.spawnSync(
    ["bun", "--no-env-file", CLI, "made-up-service", "made-up-account", "MADE_UP_KEY"],
    {
      env: scratchEnv(dir, { PATH: `${dir}:${process.env.PATH}` }),
    },
  )
  expect(run.exitCode).toBe(2)
  expect(run.stderr.toString()).toContain("usage")
  expect(run.stdout.toString() + run.stderr.toString()).not.toContain(TOKEN)
})
