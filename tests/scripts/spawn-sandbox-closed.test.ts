import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { FACTORY_SETTINGS, launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const temp = Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"]).stdout.toString().trim()
const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
const builtOf = (r: { home: string }, file: string) =>
  JSON.parse(readFileSync(settingsOf(r, file), "utf8"))

// --sandbox starts a worker, a reviewer or a probe in the closed sandbox: the probe's block, with loopback, the Keychain and the data folder's secret files closed to its shell commands, and outbound hosts held to the list a worker's loop needs.
const closedOf = (home: string, data = join(home, ".playground")) => ({
  allowUnsandboxedCommands: false,
  enabled: true,
  enableWeakerNetworkIsolation: true,
  excludedCommands: ["docker ps", "docker ps *"],
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
    denyRead: [
      join(home, "Library", "Keychains"),
      join(data, "dumps"),
      join(data, "remote-key.json"),
      join(data, "whatsapp"),
    ].sort(),
    denyWrite: expect.any(Array),
  },
  network: {
    allowedDomains: ["api.github.com", "github.com", "registry.npmjs.org"],
    allowUnixSockets: [join(data, "herdr"), join(home, ".agent-browser")].sort(),
    strictAllowlist: true,
  },
})

describe("--sandbox starts a worker, a reviewer or a probe in the closed sandbox", () => {
  const id = "b8f48a29-2ab2-4dc3-b37f-5a0525fe5c38"
  const closed = "factory-settings-sandbox-closed-400k.json"

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md", "--sandbox"]],
    [
      "a reviewer's column",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1", "--sandbox"],
    ],
    ["a probe", ["--sandbox", "probe", "probe-x", "ops", "p.md"]],
    ["a probe's column", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md", "--sandbox"]],
  ])("%s starts on the closed sandbox's file, and its row records it", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, closed)} --dangerously-skip-permissions`,
    )
    expect(builtOf(r, closed)).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
      sandbox: closedOf(r.home),
    })
    expect(r.roster).toContain("sandbox=on")
    expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
    expect(existsSync(settingsOf(r, "factory-settings-sandbox-400k.json"))).toBe(false)
  })

  test("a start without it records nothing new on its row", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster?.some((word) => word.startsWith("sandbox="))).toBe(false)
  })

  test.each([
    [
      "a tester",
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md", "--pr", "1", "--sandbox"],
    ],
    ["a runner", ["runner", "runner-calm-heron", "b.md", "--sandbox"]],
    ["a manager", ["manager", "optimizer", "b.md", "--sandbox"]],
    ["a resume", ["resume", "worker-brave-otter", root, id, "--sandbox"]],
    ["a restore", ["restore", "--sandbox"]],
    ["a close", ["close", "worker-brave-otter", "--sandbox"]],
  ])("%s is refused it before herdr runs", async (_, args) => {
    const r = await spawn(args, [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "claude",
    })
    expect(r.code).toBe(2)
    expect(r.err).toContain("--sandbox is for a worker's, a reviewer's or a probe's start")
    expect(r.roster).toBeUndefined()
  })

  test("a resumed worker whose row records it keeps the closed sandbox", async () => {
    const name = "worker-brave-otter"
    const r = await spawn(
      ["resume", name, root, id],
      [],
      {
        ROSTER_JSON: JSON.stringify({
          agents: [{ kind: "worker", name, role: "worker", sandbox: "on", status: "working" }],
        }),
      },
      undefined,
      { name, backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, closed)} `)
    expect(builtOf(r, closed).sandbox).toEqual(closedOf(r.home))
    expect(r.roster).toContain("sandbox=on")
  })

  test("a worker on GLM takes the closed sandbox in GLM's own file", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm", "--sandbox"],
      [],
    )
    expect(r.code, r.err).toBe(0)
    const built = builtOf(r, "factory-settings-glm-sandbox-closed-400k.json")
    expect(built.sandbox).toEqual(closedOf(r.home))
    expect(built.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0")
  })

  test("a worker on a scratch data folder has that folder's secret files closed", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--sandbox"], [], {
      SCRATCH_DATA: "1",
    })
    expect(r.code, r.err).toBe(0)
    const data = join(r.home, "scratch-data")
    const built = JSON.parse(readFileSync(join(data, closed), "utf8"))
    expect(built.sandbox).toEqual(closedOf(r.home, data))
  })
})

// The closed sandbox refuses every Keychain read, so a start from inside it cannot tell an --account's item is there; the new pane's shell, outside the sandbox, still stops on a missing one before claude runs.
describe("a start from inside the sandbox leaves the Keychain check to the new pane", () => {
  const inside = { FAKE_NO_ITEM: "1", SANDBOX_RUNTIME: "1" }

  test("a Claude --account starts, naming the check it left", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      inside,
    )
    expect(r.code, r.err).toBe(0)
    expect(r.err).toContain(
      "the sandbox closes the Keychain to this shell, so the new pane checks the playground-claude-oauth item for spare@example.com",
    )
  })

  test("a GLM key starts, naming the check it left", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], inside)
    expect(r.code, r.err).toBe(0)
    expect(r.err).toContain(
      "the sandbox closes the Keychain to this shell, so the new pane checks the playground-glm item for zai",
    )
  })

  test("outside the sandbox a missing item is still refused", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      { FAKE_NO_ITEM: "1" },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "the Keychain holds no playground-claude-oauth item for spare@example.com",
    )
  })
})
