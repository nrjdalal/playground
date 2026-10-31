import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

const API = resolve(import.meta.dir, "../../../../../api/hono")
const HOSTED = join(API, "src/hosted.ts")

// A child Bun in the API's folder, so its tsconfig's @/ resolves, on the hosted build's environment: the hosted switch and the Vercel adapter are read once, when their modules load.
const child = (script: string, env: Record<string, string>) => {
  const run = Bun.spawnSync(["bun", "-e", script], {
    cwd: API,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      BETTER_AUTH_SECRET: "yard-test-secret",
      GITHUB_CLIENT_ID: "yard-test-client",
      GITHUB_CLIENT_SECRET: "yard-test-client-secret",
      HONO_APP_URL: "http://127.0.0.1:4000",
      HONO_TRUSTED_ORIGINS: "http://127.0.0.1:3000",
      NODE_ENV: "test",
      PLAYGROUND_HOSTED: "1",
      PORT: "0",
      POSTGRES_URL: "postgres://postgres:pw@127.0.0.1:9/postgres",
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
  })
  return { code: run.exitCode, err: run.stderr.toString(), out: run.stdout.toString() }
}

// Opens Yard's socket on the hosted export and prints the first event last, after the request log: open once the upgrade answers 101, else error.
const opens = (serve: string) =>
  `const exported = (await import(${JSON.stringify(HOSTED)})).default; const port = await (${serve})(exported); const socket = new WebSocket("ws://127.0.0.1:" + port + "/api/v1/yard/socket"); socket.onopen = () => { console.log("open"); process.exit(0) }; socket.onerror = () => { console.log("error"); process.exit(1) }`

describe("Yard's socket", () => {
  test("upgrades on the Vercel export, a server that never listened", () => {
    const run = child(
      opens(
        `async (server) => { await new Promise((done) => server.listen(0, "127.0.0.1", done)); return server.address().port }`,
      ),
      { VERCEL: "1" },
    )
    expect(run.err).not.toContain("error:")
    expect(run.out.trim().split("\n").at(-1)).toBe("open")
  })

  test("upgrades on Bun.serve, the shape a local or Docker run takes", () => {
    const run = child(opens(`async (shape) => Bun.serve(shape).port`), {})
    expect(run.err).not.toContain("error:")
    expect(run.out.trim().split("\n").at(-1)).toBe("open")
  })
})
