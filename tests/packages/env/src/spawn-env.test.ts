import { describe, expect, test } from "bun:test"

import { spawnEnvOf } from "../../../../packages/env/src/spawn-env"

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
})
