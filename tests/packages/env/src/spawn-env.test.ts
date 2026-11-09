import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { spawnEnvOf } from "../../../../packages/env/src/spawn-env"

const DIST = join(import.meta.dir, "../../../../packages/env/dist/api-hono.mjs")

describe("spawnEnvOf", () => {
  // #1297: a PLAYGROUND_* name the API read after it started, a .env set included, rides to the program it starts; a value the .env set on its own stays off, since the child's own checkout reads its own .env and dotenv never overrides a set one
  test("keeps a late PLAYGROUND_* name on and a late .env value off", () => {
    const source = {
      HOME: "/home/me",
      PATH: "/bin",
      POSTGRES_URL: "postgres://this-checkout",
      BETTER_AUTH_SECRET: "s",
      PLAYGROUND_HERDR_SESSION: "probe",
      PLAYGROUND_LOAD_MULT: "2",
    }
    const env = spawnEnvOf(source, new Set(["POSTGRES_URL", "BETTER_AUTH_SECRET"]))
    expect(env.PLAYGROUND_HERDR_SESSION).toBe("probe")
    expect(env.PLAYGROUND_LOAD_MULT).toBe("2")
    expect(env.BETTER_AUTH_SECRET).toBeUndefined()
    expect(env.HOME).toBe("/home/me")
    expect(env.PATH).toBe("/bin")
    expect(env.POSTGRES_URL).toBeUndefined()
  })

  test("keeps a name the shell held before the .env read, introduced or not", () => {
    const env = spawnEnvOf({ PATH: "/bin", POSTGRES_URL: "postgres://shell" }, new Set(["OTHER"]))
    expect(env.POSTGRES_URL).toBe("postgres://shell")
  })

  // Bun 1.4.4's spawn with no env option hands the child the startup environment, not the process.env later reads changed, so a session start names its env
  test("a child spawned with the env reads a name the parent set after it started", async () => {
    const source = {
      ...process.env,
      PLAYGROUND_HERDR_SESSION: "probe",
      POSTGRES_URL: "postgres://live",
    }
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `process.stdout.write(\`\${process.env.PLAYGROUND_HERDR_SESSION} \${process.env.POSTGRES_URL ?? "unset"}\`)`,
      ],
      { env: spawnEnvOf(source, new Set(["POSTGRES_URL"])), stdin: "ignore", stdout: "pipe" },
    )
    expect((await new Response(child.stdout).text()).trim()).toBe("probe unset")
  })

  // the .env read's recording is what keeps its POSTGRES_URL and secrets off spawn.sh's child: a PLAYGROUND_* name the .env introduced rides with the .env's value, a name the shell held first keeps the shell's value, and the rest of the .env stays off (round 2: no test ran the real read, so both recording lines could go with nothing red)
  test("the real .env read feeds spawnEnv from a folder two below the .env", async () => {
    const root = mkdtempSync(join(tmpdir(), "spawn-env-dotenv-"))
    const below = join(root, "a", "b")
    mkdirSync(below, { recursive: true })
    writeFileSync(
      join(root, ".env"),
      [
        "PLAYGROUND_LOAD_MULT=9",
        "POSTGRES_URL=postgres://scratch-env",
        "BETTER_AUTH_SECRET=scratch-secret",
        "NODE_ENV=test",
      ].join("\n"),
    )
    const shell = { ...process.env, POSTGRES_URL: "postgres://shell" }
    delete shell.PLAYGROUND_LOAD_MULT
    delete shell.BETTER_AUTH_SECRET
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `import { spawnEnv } from ${JSON.stringify(DIST)}; const env = spawnEnv(); process.stdout.write([\`mult=\${env.PLAYGROUND_LOAD_MULT ?? "unset"}\`, \`pg=\${env.POSTGRES_URL ?? "unset"}\`, \`secret=\${env.BETTER_AUTH_SECRET ?? "unset"}\`].join(" "))`,
      ],
      { cwd: below, env: shell, stdin: "ignore", stdout: "pipe" },
    )
    expect((await new Response(child.stdout).text()).trim()).toBe(
      "mult=9 pg=postgres://shell secret=unset",
    )
    rmSync(root, { recursive: true, force: true })
  })
})
