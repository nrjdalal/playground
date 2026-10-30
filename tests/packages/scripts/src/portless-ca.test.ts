import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { portlessCa } from "../../../../packages/scripts/src/portless-ca"

const MODULE = join(import.meta.dir, "../../../../packages/scripts/src/portless-ca.ts")
const DIR = mkdtempSync(join(tmpdir(), "portless-ca-"))
const CA = join(DIR, "ca.pem")
const KEY = join(DIR, "key.pem")

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const made = Bun.spawnSync(
  [
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-keyout",
    KEY,
    "-out",
    CA,
  ],
  { stderr: "pipe", stdout: "pipe" },
)
if (made.exitCode !== 0) throw new Error(made.stderr.toString())

const childEnv = () => {
  const env: Record<string, string | undefined> = { ...process.env, PORTLESS_STATE_DIR: DIR }
  delete env.NODE_EXTRA_CA_CERTS
  return env
}

const client = async (name: string, rerun: boolean, port: number) => {
  const script = join(DIR, `${name}.ts`)
  writeFileSync(
    script,
    [
      rerun
        ? `import { withPortlessCa } from ${JSON.stringify(MODULE)}\nawait withPortlessCa()`
        : "",
      `const answer = await fetch("https://localhost:${port}/").then((r) => r.text(), (e) => "refused: " + e.message)`,
      "console.log(answer)",
    ].join("\n"),
  )
  const child = Bun.spawn([process.execPath, script], {
    env: childEnv(),
    stderr: "pipe",
    stdout: "pipe",
  })
  return { code: await child.exited, out: (await new Response(child.stdout).text()).trim() }
}

describe("portlessCa", () => {
  test("names ca.pem in portless's state folder", () => {
    expect(portlessCa({ PORTLESS_STATE_DIR: DIR })).toBe(CA)
  })

  test("names nothing when the state folder holds no ca.pem", () => {
    expect(portlessCa({ PORTLESS_STATE_DIR: join(DIR, "missing") })).toBeNull()
  })

  test("keeps an extra CA the process was started with", () => {
    expect(portlessCa({ NODE_EXTRA_CA_CERTS: "/other.pem", PORTLESS_STATE_DIR: DIR })).toBeNull()
  })
})

describe("withPortlessCa", () => {
  test("a Bun client reaches a stack served under portless's CA only after it runs again with it", async () => {
    const server = Bun.serve({
      fetch: () => new Response("ok"),
      port: 0,
      tls: { cert: Bun.file(CA), key: Bun.file(KEY) },
    })
    const port = server.port ?? 0
    try {
      const bare = await client("bare", false, port)
      expect(bare.out).toStartWith("refused: ")
      expect(await client("rerun", true, port)).toEqual({ code: 0, out: "ok" })
    } finally {
      server.stop(true)
    }
  })

  test("the run with the CA hands back its exit code", async () => {
    const script = join(DIR, "exit.ts")
    writeFileSync(
      script,
      `import { withPortlessCa } from ${JSON.stringify(MODULE)}\nawait withPortlessCa()\nprocess.exit(process.env.NODE_EXTRA_CA_CERTS ? 7 : 3)`,
    )
    const child = Bun.spawn([process.execPath, script], {
      env: childEnv(),
      stderr: "pipe",
      stdout: "pipe",
    })
    expect(await child.exited).toBe(7)
  })
})
