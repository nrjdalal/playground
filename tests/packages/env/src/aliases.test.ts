import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { applyEnvAliases, DESK_ENV, renamedEnv } from "../../../../packages/env/src/aliases"

const ROOT = join(import.meta.dir, "../../../..")

describe("renamedEnv", () => {
  test("takes each DESK_ env name to PLAYGROUND_", () => {
    expect(renamedEnv("DESK_FIXTURE")).toBe("PLAYGROUND_FIXTURE")
    expect(renamedEnv("DESK_HERDR_SESSIONS")).toBe("PLAYGROUND_HERDR_SESSIONS")
    expect(renamedEnv("DESK_DEBUG_MIC_DIR")).toBe("PLAYGROUND_DEBUG_MIC_DIR")
  })

  test("leaves a constant's name and every other name alone", () => {
    expect(renamedEnv("DESK_MAP")).toBeUndefined()
    expect(renamedEnv("PATH")).toBeUndefined()
  })
})

describe("applyEnvAliases", () => {
  test("fills each new name from its old one", () => {
    const env: Record<string, string | undefined> = { DESK_LIVE_READS: "true" }
    applyEnvAliases(env)
    expect(env.PLAYGROUND_LIVE_READS).toBe("true")
  })

  test("keeps a new name already set", () => {
    const env: Record<string, string | undefined> = {
      DESK_FIXTURE: "shipped",
      PLAYGROUND_FIXTURE: "1",
    }
    applyEnvAliases(env)
    expect(env.PLAYGROUND_FIXTURE).toBe("1")
  })

  test("fills a new name set empty from its old one, as the old name read empty as unset", () => {
    const env: Record<string, string | undefined> = { DESK_FIXTURE: "1", PLAYGROUND_FIXTURE: "" }
    applyEnvAliases(env)
    expect(env.PLAYGROUND_FIXTURE).toBe("1")
  })

  test("every DESK_ name in the tree still reads", async () => {
    const tracked = (
      await Bun.$`git -C ${ROOT} grep -ohIP "(?<![A-Z0-9_])PLAYGROUND_[A-Z0-9_]*[A-Z0-9]" -- ":!CHANGELOG.md"`.text()
    )
      .split("\n")
      .filter(Boolean)
    const names = [...new Set(tracked)].filter((name) =>
      DESK_ENV.has(name.slice("PLAYGROUND_".length)),
    )
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) {
      const old = `DESK_${name.slice("PLAYGROUND_".length)}`
      const env: Record<string, string | undefined> = { [old]: "set" }
      applyEnvAliases(env)
      expect([old, env[name]]).toEqual([old, "set"])
    }
  })

  test("a process that imports it reads an old name under its new one", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `await import(${JSON.stringify(join(ROOT, "packages/env/src/aliases.ts"))}); console.log(process.env.PLAYGROUND_FIXTURE)`,
      ],
      { env: { ...process.env, DESK_FIXTURE: "1", PLAYGROUND_FIXTURE: undefined }, stdout: "pipe" },
    )
    expect((await new Response(proc.stdout).text()).trim()).toBe("1")
  })

  test("Bun loads it from its source, so a checkout nothing has built yet still reads old names", () => {
    expect(Bun.resolveSync("@packages/env/aliases", join(ROOT, "packages/scripts"))).toBe(
      join(ROOT, "packages/env/src/aliases.ts"),
    )
  })

  test("a factory hook's command takes PLAYGROUND_REPO, else the project's main checkout from its git common dir", async () => {
    const { hooks } = await Bun.file(join(ROOT, "scripts/factory-settings.json")).json()
    const command: string = Object.values(
      hooks as Record<string, { hooks: { command: string }[] }[]>,
    )
      .flat()
      .flatMap((m) => m.hooks)
      .map((h) => h.command)
      .find((c) => c.includes("--git-common-dir"))!
    expect(command).toStartWith('R="${PLAYGROUND_REPO}";')
    const resolver = command.slice(0, command.indexOf('; [ -n "$R" ] &&'))
    const read = (env: Record<string, string>) =>
      Bun.spawnSync(["sh", "-c", `${resolver}; printf %s "$R"`], {
        env: { CLAUDE_PROJECT_DIR: ROOT, PATH: process.env.PATH!, ...env },
      }).stdout.toString()
    const common = Bun.spawnSync([
      "git",
      "-C",
      ROOT,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
      .stdout.toString()
      .trim()
    expect(read({ PLAYGROUND_REPO: "/new" })).toBe("/new")
    expect(read({})).toBe(join(common, ".."))
  })
})
