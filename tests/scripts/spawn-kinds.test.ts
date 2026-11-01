import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { FACTORY_SETTINGS, launchAfterRm, opened, placing, root, spawn, zai } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// every kind of session compacts in one 400k window.
describe("every session compacts in one 400k window (#1805)", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
  const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
  const builtOf = (r: { home: string }, file: string) =>
    JSON.parse(readFileSync(settingsOf(r, file), "utf8"))
  const roster = JSON.stringify({
    agents: [
      { kind: "builder", name: "x7mh4d-builder", role: "manager", status: "working", task: "t" },
    ],
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"]],
    ["a runner", ["runner", "runner-calm-heron", "b.md"]],
    ["a reviewer", ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]],
    ["a tester", ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"]],
    ["a probe", ["column", "probe", "probe-x", "ops", "w1:p2", "p.md"]],
    ["a lead", ["column", "lead", "planner", "dispatcher", "w1:p2", "h.md"]],
    [
      "a lead by its roster kind",
      ["column", "lead", "x7mh4d-builder", "dispatcher", "w1:p2", "l.md"],
    ],
    ["the dispatcher", ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"]],
    ["an optimizer", ["manager", "optimizer", "b.md"]],
  ])("%s starts with the 400k window", async (_, args) => {
    const r = await spawn(args, [], { ROSTER_JSON: roster })
    expect(r.code).toBe(0)
    const file = "factory-settings-400k.json"
    expect(launchAfterRm(r).split(" --settings ")).toHaveLength(2)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, file)} --dangerously-skip-permissions`,
    )
    expect(builtOf(r, file)).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
    })
  })

  test("context.window sets the window, in the built file's name and its autoCompactWindow", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      SETTINGS_JSON: JSON.stringify({ "context.window": 300000 }),
    })
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-300k.json")} `,
    )
    expect(builtOf(r, "factory-settings-300k.json").autoCompactWindow).toBe(300000)
  })

  test.each([
    ["a worker", "worker-brave-otter"],
    ["a runner", "runner-calm-heron"],
    ["a reviewer", "reviewer-x"],
    ["a tester", "tester-x"],
    ["a lead", "builder"],
    ["a lead by its roster kind", "x7mh4d-builder"],
    ["the dispatcher", "dispatcher"],
  ])("%s resumes with the 400k window", async (_, name) => {
    const r = await spawn(["resume", name, root, id], [], { ROSTER_JSON: roster }, undefined, {
      name,
      backend: "claude",
    })
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain(` --resume ${id} `)
    expect(launchAfterRm(r)).toContain(
      ` --settings ${settingsOf(r, "factory-settings-400k.json")} `,
    )
    expect(builtOf(r, "factory-settings-400k.json").autoCompactWindow).toBe(400000)
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md", "--backend", "glm"], undefined],
    ["the second dispatcher", ["manager", "dispatcher-2", "b.md", "--backend", "glm"], undefined],
    ["a resumed worker", ["resume", "worker-brave-otter", root, id], "worker-brave-otter"],
    ["a resumed lead", ["resume", "builder", root, id], "builder"],
  ])("%s on GLM takes the 400k window", async (_, args, pinned) => {
    const pin = pinned ? { name: pinned, backend: "glm" } : undefined
    const r = await spawn(args, [], {}, undefined, pin)
    expect(r.code).toBe(0)
    const file = "factory-settings-glm-400k.json"
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).autoCompactWindow).toBe(400000)
    expect(builtOf(r, file).env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("0")
  })

  test("the built file keeps every hook command of the real factory settings byte for byte", async () => {
    const real = readFileSync(join(root, "scripts", "factory-settings.json"), "utf8")
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      (home) => writeFileSync(join(home, ".playground", "factory-settings.json"), real),
    )
    expect(r.code).toBe(0)
    const source = JSON.parse(real)
    const built = builtOf(r, "factory-settings-400k.json")
    expect(JSON.stringify(built.hooks)).toBe(JSON.stringify(source.hooks))
    expect(built).toEqual({
      ...source,
      autoCompactWindow: 400000,
      enabledPlugins: { ...source.enabledPlugins, "ws-home@ws": false },
    })
  })

  // The session loads its own merged skill set in place, and the home set user scope turns on stays off, so no name is shipped twice.
  test("a session loads the merged skill plugin its repo resolves to", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { ROSTER_JSON: roster })
    expect(r.code).toBe(0)
    const plugin = launchAfterRm(r).match(/ --plugin-dir (\S+)/)?.[1] ?? ""
    expect(plugin).toStartWith(join(r.home, ".playground", "orgs", "home"))
    expect(readdirSync(join(plugin, "skills"))).toContain("playbook")
    expect(
      JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name,
    ).toBe("ws-home")
    expect(builtOf(r, "factory-settings-400k.json").enabledPlugins).toEqual({ "ws-home@ws": false })
  })

  test("--check builds no settings file", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--check"], [])
    expect(r.code).toBe(0)
    expect(existsSync(settingsOf(r, "factory-settings-400k.json"))).toBe(false)
  })
})

describe("the backend pin carries a start onto its resume", () => {
  const lookup = `tk="$(security find-generic-password -s playground-glm -a zai -w)" || exit 1; [ -n "$tk" ] || { echo "The playground-glm item for zai holds an empty token; save it again with playground accounts add --provider glm --label zai, then respawn." >&2; exit 1; }; ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic ANTHROPIC_AUTH_TOKEN="$tk" ANTHROPIC_DEFAULT_OPUS_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_SONNET_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash ENABLE_TOOL_SEARCH=true `
  const command = launchAfterRm
  const pinOf = (r: Awaited<ReturnType<typeof spawn>>, name: string) =>
    readFileSync(join(r.home, ".playground", "backends", name), "utf8").trim()

  test("a start records glm or claude beside the session's name", async () => {
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [])
    expect(glm.code).toBe(0)
    expect(pinOf(glm, "worker-brave-otter")).toBe("glm")
    const plain = await spawn(["worker", "worker-calm-heron", "b.md"], [])
    expect(plain.code).toBe(0)
    expect(pinOf(plain, "worker-calm-heron")).toBe("claude")
  })

  test("a resume of a session started on glm relaunches the whole GLM launch from its pin", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root], [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "glm",
    })
    expect(r.code).toBe(0)
    expect(command(r)).toStartWith(
      `(${lookup}env PLAYGROUND_ROLE=worker claude --resume worker-brave-otter -n worker-brave-otter `,
    )
    expect(command(r)).toContain(" --model 'glm-5.3-flash[1m]' --effort high ")
    expect(command(r)).not.toContain("claude-opus")
    const glmSettings = join(r.home, ".playground", "factory-settings-glm-400k.json")
    expect(command(r)).toContain(` --settings ${glmSettings} --dangerously-skip-permissions`)
    expect(r.security).toEqual(["find-generic-password -s playground-glm -a zai"])
  })

  test("a resume whose pin says claude stays on Claude", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root], [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "claude",
    })
    expect(r.code).toBe(0)
    expect(command(r)).toStartWith("(env PLAYGROUND_ROLE=worker claude --resume worker-brave-otter")
    expect(command(r)).not.toContain("ANTHROPIC_BASE_URL")
  })

  test("a resume with no pin and no --backend refuses, naming what to do", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root], [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("no backend pin for worker-brave-otter")
  })

  test("a resume that carries an explicit --backend with no pin heals the record", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root, "--backend", "glm"], [])
    expect(r.code).toBe(0)
    expect(pinOf(r, "worker-brave-otter")).toBe("glm")
  })

  test("a pinless resume with --backend claude relaunches on Claude and heals the record", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root, "--backend", "claude"], [])
    expect(r.code).toBe(0)
    expect(pinOf(r, "worker-brave-otter")).toBe("claude")
    expect(command(r)).toStartWith("(env PLAYGROUND_ROLE=worker claude --resume worker-brave-otter")
    expect(command(r)).not.toContain("ANTHROPIC_BASE_URL")
    expect(r.security).toBeUndefined()
  })

  test("a checker with no pin resumes on --backend claude and heals the record", async () => {
    const r = await spawn(["resume", "reviewer-nopin", root, "--backend", "claude"], [])
    expect(r.code).toBe(0)
    expect(pinOf(r, "reviewer-nopin")).toBe("claude")
  })

  test("a checker takes no --backend glm", async () => {
    const r = await spawn(["resume", "reviewer-nopin", root, "--backend", "glm"], [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("a reviewer runs on Claude, so it takes no --backend glm")
  })

  test("a checker's no-pin refusal names --backend claude alone", async () => {
    const r = await spawn(["resume", "reviewer-nopin", root], [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("Resume it with --backend claude")
    expect(r.err).not.toContain("glm or --backend claude")
  })

  test.each([
    ["a matching one", "glm", "glm"],
    ["a conflicting one", "claude", "glm"],
  ])("a standing pin decides: %s is refused beside it", async (_, pinned, given) => {
    const r = await spawn(
      ["resume", "worker-brave-otter", root, "--backend", given],
      [],
      {},
      undefined,
      {
        name: "worker-brave-otter",
        backend: pinned,
      },
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("the pin decides")
  })

  test("a pin that reads neither glm nor claude refuses, like a missing one", async () => {
    const r = await spawn(["resume", "worker-brave-otter", root], [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "openai",
    })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("reads neither glm nor claude")
  })

  test("a start writes its pin only once herdr has the session", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      FAKE_HERDR_CREATE_FAIL: "1",
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("herdr opened no session")
    expect(existsSync(join(r.home, ".playground", "backends", "worker-brave-otter"))).toBe(false)
    expect(existsSync(join(r.home, ".playground", "launch", "worker-brave-otter.sh"))).toBe(false)
  })
})
