import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { overridesFor } from "../../../../packages/scripts/src/portless"

const script = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "scripts",
  "src",
  "portless.ts",
)
const scratch = mkdtempSync(join(tmpdir(), "portless-env-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The env portless.ts gives the command it starts, as the dashboard supervisor starts its web: the child prints its own NODE_EXTRA_CA_CERTS.
const childCa = async (env: Record<string, string | undefined>): Promise<string> => {
  const proc = Bun.spawn(
    [
      process.execPath,
      script,
      process.execPath,
      "-e",
      "console.log(process.env.NODE_EXTRA_CA_CERTS ?? '')",
    ],
    {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: undefined, ...env },
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  expect(await proc.exited).toBe(0)
  return (await new Response(proc.stdout).text()).trim()
}

describe("overridesFor", () => {
  test("tells a worktree's apps their own branch-prefixed names", () => {
    for (const url of [
      "https://feat.playground.localhost",
      "https://feat.api.playground.localhost",
    ]) {
      expect(overridesFor(url)).toEqual({
        HONO_APP_URL: "https://feat.api.playground.localhost",
        HONO_TRUSTED_ORIGINS: "https://feat.playground.localhost",
        NEXT_PUBLIC_API_URL: "https://feat.api.playground.localhost",
        NEXT_PUBLIC_APP_URL: "https://feat.playground.localhost",
      })
    }
  })

  test("keeps the live dashboard's apps on their own names, and trusts the bare web origin too", () => {
    for (const url of [
      "https://desk.playground.localhost",
      "https://desk.api.playground.localhost",
    ]) {
      expect(overridesFor(url, true)).toEqual({
        HONO_APP_URL: "https://desk.api.playground.localhost",
        HONO_TRUSTED_ORIGINS: "https://desk.playground.localhost,https://playground.localhost",
        NEXT_PUBLIC_API_URL: "https://desk.api.playground.localhost",
        NEXT_PUBLIC_APP_URL: "https://desk.playground.localhost",
      })
    }
  })

  test("keeps a proxy's own port in every origin", () => {
    expect(overridesFor("https://desk.playground.localhost:8443", true).HONO_TRUSTED_ORIGINS).toBe(
      "https://desk.playground.localhost:8443,https://playground.localhost:8443",
    )
  })
})

// a production web started with no CA of portless's failed TLS on every server fetch, so each render waited out readSession's 20 s.
describe("the env portless.ts starts an app with", () => {
  const state = join(scratch, "state")
  const ca = join(state, "ca.pem")

  test("carries portless's CA, so the app's server fetches to an https sibling verify", async () => {
    rmSync(state, { force: true, recursive: true })
    mkdirSync(state, { recursive: true })
    writeFileSync(ca, "-----BEGIN CERTIFICATE-----\n")
    expect(
      await childCa({
        PORTLESS_STATE_DIR: state,
        PORTLESS_URL: "https://feat.playground.localhost",
      }),
    ).toBe(ca)
  })

  test("keeps a CA the caller set, and adds none when portless has none", async () => {
    expect(
      await childCa({
        NODE_EXTRA_CA_CERTS: "/own/ca.pem",
        PORTLESS_STATE_DIR: state,
        PORTLESS_URL: "https://feat.playground.localhost",
      }),
    ).toBe("/own/ca.pem")
    expect(
      await childCa({
        PORTLESS_STATE_DIR: join(scratch, "none"),
        PORTLESS_URL: "https://feat.playground.localhost",
      }),
    ).toBe("")
  })
})
