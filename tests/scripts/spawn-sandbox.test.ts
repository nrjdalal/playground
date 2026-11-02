import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { FACTORY_SETTINGS, launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// The main checkout spawn.sh resolves, git's common dir less .git, whose tree a sandboxed session may not write.
const main = dirname(
  Bun.spawnSync(["git", "-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"])
    .stdout.toString()
    .trim(),
)
const entries = (folder: string, keep: string) =>
  existsSync(folder)
    ? readdirSync(folder)
        .sort()
        .filter((name) => name !== keep)
        .map((name) => join(folder, name))
    : []
const temp = Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trim()

const sandboxOf = (home: string, data = join(home, ".playground")) => ({
  allowUnsandboxedCommands: false,
  enabled: true,
  enableWeakerNetworkIsolation: true,
  excludedCommands: [
    "docker port playground-*",
    "docker ps",
    "docker ps *",
    "docker rm -fv playground-*",
    "docker run -d --name playground-* -e POSTGRES_PASSWORD=* -p 127.0.0.1::5432 postgres:alpine",
    "docker run -d --name playground-* -p 127.0.0.1::6379 redis:alpine",
    "docker start playground-*",
    "docker stop playground-*",
  ],
  failIfUnavailable: true,
  filesystem: {
    allowWrite: [
      data,
      join(home, ".agent-browser"),
      join(home, ".bun", "install", "cache"),
      join(home, ".cache", "turbo"),
      join(home, ".portless"),
      ...(temp ? [temp.replace(/\/$/, "")] : []),
    ].sort(),
    denyWrite: [
      ...entries(main, ".git").filter((path) => path !== join(main, ".claude")),
      ...entries(join(main, ".claude"), "worktrees"),
    ],
  },
  network: {
    allowLocalBinding: true,
    allowUnixSockets: [join(data, "herdr"), join(home, ".agent-browser")].sort(),
  },
})

const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

describe("a probe runs its shell commands in Claude Code's sandbox", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"

  test.each([
    ["a probe in its own workspace", ["probe", "probe-x", "ops", "p.md"]],
    ["a probe's column", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md"]],
  ])("%s starts with the sandbox's settings file", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    const file = "factory-settings-sandbox-400k.json"
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, file)} --dangerously-skip-permissions`,
    )
    expect(builtOf(r, file)).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
      sandbox: sandboxOf(r.home),
    })
    expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
  })

  test("the main checkout's tree is denied but .git and .claude/worktrees, and nothing else is", async () => {
    const r = await spawn(["probe", "probe-x", "ops", "p.md"], [])
    expect(r.code, r.err).toBe(0)
    const { denyWrite } = builtOf(r, "factory-settings-sandbox-400k.json").sandbox.filesystem
    expect(denyWrite).toContain(join(main, "scripts"))
    expect(denyWrite).not.toContain(join(main, ".git"))
    expect(denyWrite).not.toContain(join(main, ".claude"))
    expect(denyWrite).not.toContain(join(main, ".claude", "worktrees"))
    expect(
      denyWrite.filter(
        (path: string) => dirname(path) !== main && dirname(path) !== join(main, ".claude"),
      ),
    ).toEqual([])
  })

  test("a resumed probe keeps the sandbox", async () => {
    const name = "probe-x"
    const r = await spawn(["resume", name, root, id], [], {}, undefined, {
      name,
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    const file = "factory-settings-sandbox-400k.json"
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).sandbox).toEqual(sandboxOf(r.home))
  })

  test("a probe on GLM keeps the sandbox in GLM's own file", async () => {
    const r = await spawn(
      ["column", "probe", "probe-x", "ops", "w1:p2", "p.md", "--backend", "glm"],
      [],
    )
    expect(r.code, r.err).toBe(0)
    const built = builtOf(r, "factory-settings-glm-sandbox-400k.json")
    expect(built.sandbox).toEqual(sandboxOf(r.home))
    expect(built.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0")
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"]],
    ["a runner", ["runner", "runner-calm-heron", "b.md"]],
    ["a reviewer", ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]],
    ["a tester", ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"]],
    ["the dispatcher", ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"]],
    ["an optimizer", ["manager", "optimizer", "b.md"]],
  ])("%s keeps today's settings, with no sandbox", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
    expect(builtOf(r, "factory-settings-400k.json").sandbox).toBeUndefined()
  })
})
