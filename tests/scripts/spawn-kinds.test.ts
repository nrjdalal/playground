import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { ID_ALPHABET } from "../../packages/config/src/kinds"
import {
  BRIEF_TEXT,
  FACTORY_SETTINGS,
  herdrCalls,
  homes,
  launchAfterRm,
  launchOf,
  opened,
  placing,
  root,
  scratch,
  spawn,
  usage,
  unplugged,
  zai,
} from "./spawn-fake"

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

describe("--brief gives a resumed session its first prompt", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
  const brief = "handoffs/restart-brief.md"
  const command = launchAfterRm

  test.each([
    ["after the words", ["resume", "dispatcher", root, id, "--brief", brief]],
    ["before the mode", ["--brief", brief, "resume", "dispatcher", root, id]],
  ])("%s: the prompt names the file, and the session reads it", async (_, args) => {
    const r = await spawn(args, [], { BRIEF_FILE: brief }, undefined, {
      name: "dispatcher",
      backend: "claude",
    })
    expect(r.code).toBe(0)
    const home = join(scratch, `home-${homes}`)
    expect(unplugged(command(r))).toBe(
      `(env PLAYGROUND_ROLE=dispatcher claude --resume ${id} -n dispatcher --model claude-opus-5-5 --effort high --settings ${home}/.playground/factory-settings-400k.json --dangerously-skip-permissions "You are dispatcher, resumed. Load the playbook skill first. Your brief is in ~/.playground/${brief}: read it in full and follow it.")`,
    )
    expect(command(r)).not.toContain("--brief")
    const seen = [...placing(r).flat(), ...(r.roster ?? []), r.out, r.err].join("\n")
    expect(seen).not.toContain(BRIEF_TEXT)
  })

  // a session idle at the restart takes no turn, so it never acts on after-resume's context until a prompt reaches it
  test("with no --brief a resume still takes one turn, so it acts on after-resume's instruction", async () => {
    const r = await spawn(
      ["resume", "dispatcher", root, id],
      [],
      { BRIEF_FILE: brief },
      undefined,
      {
        name: "dispatcher",
        backend: "claude",
      },
    )
    const home = join(scratch, `home-${homes}`)
    expect(unplugged(command(r))).toBe(
      `(env PLAYGROUND_ROLE=dispatcher claude --resume ${id} -n dispatcher --model claude-opus-5-5 --effort high --settings ${home}/.playground/factory-settings-400k.json --dangerously-skip-permissions "You are dispatcher, resumed after a restart. Act on the after-resume instruction in your context first, then carry on.")`,
    )
  })

  test.each([
    ["a space", "b c.md"],
    ["a quote", 'b"c.md'],
    ["a dollar", "$(id).md"],
    ["a parent folder", "../brief.md"],
    ["a parent folder inside it", "handoffs/../../brief.md"],
    ["a parent folder at its end", "handoffs/.."],
  ])("a brief with %s is refused before herdr", async (_, bad) => {
    const r = await spawn(["resume", "dispatcher", root, id, "--brief", bad], [], {
      BRIEF_FILE: brief,
    })
    expect(r.code).toBe(1)
    expect(r.err).toContain("a brief is a file name under ~/.playground")
    expect(placing(r)).toEqual([])
  })

  test("a brief that is not there is refused before herdr", async () => {
    const r = await spawn(["resume", "dispatcher", root, id, "--brief", "handoffs/missing.md"], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("~/.playground/handoffs/missing.md is not a file")
    expect(placing(r)).toEqual([])
  })

  test.each([
    ["given twice", ["resume", "dispatcher", root, id, "--brief", brief, "--brief", brief]],
    ["with no file after it", ["resume", "dispatcher", root, id, "--brief"]],
    ["with an empty file", ["resume", "dispatcher", root, id, "--brief", ""]],
  ])("--brief %s is refused", async (_, args) => {
    const r = await spawn(args, [], { BRIEF_FILE: brief })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
  })

  test.each([
    ["worker", ["worker", "worker-brave-otter", "b.md", "--brief", brief]],
    ["runner", ["runner", "runner-calm-heron", "b.md", "--brief", brief]],
    ["column", ["column", "lead", "planner", "dispatcher", "w1:p2", "h.md", "--brief", brief]],
  ])("--brief with %s, which takes its brief as a word, is refused", async (_, args) => {
    const r = await spawn(args, [], { BRIEF_FILE: brief })
    expect(r.code).toBe(1)
    expect(r.err).toContain("--brief is for resume")
    expect(placing(r)).toEqual([])
  })
})

describe("--reports-to names the session a worker reports to (#1727)", () => {
  test.each([["worker", "worker-brave-otter"]])(
    "a %s with --reports-to planner reports to planner",
    async (mode, name) => {
      const r = await spawn([mode, name, "--reports-to", "planner", "b.md"], [])
      expect(r.code).toBe(0)
      expect(launchOf(r)).toContain("you report to planner.")
      expect(launchOf(r)).toContain("Report to planner with SendMessage (to: planner).")
    },
  )

  test("a value that is not a session name is refused", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--reports-to", "Bad Name"], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("it reports to a session name, not Bad Name")
    expect(placing(r)).toEqual([])
  })

  test("given twice it is usage", async () => {
    const r = await spawn(
      [
        "worker",
        "worker-brave-otter",
        "b.md",
        "--reports-to",
        "planner",
        "--reports-to",
        "builder",
      ],
      [],
    )
    expect(r.code).toBe(2)
    expect(r.err).toContain("--reports-to takes a session name, once")
    expect(placing(r)).toEqual([])
  })

  test.each([
    ["runner", ["runner", "runner-calm-heron", "b.md"]],
    ["column", ["column", "reviewer", "reviewer-brave-otter", "builder", "w1:p2", "b.md"]],
    ["probe", ["probe", "probe-x", "ops", "b.md", "--runtime", "herdr"]],
    ["manager", ["manager", "dispatcher-2", "b.md"]],
    ["resume", ["resume", "worker-brave-otter", "/tmp"]],
    ["move", ["move", "worker-brave-otter"]],
    ["restore", ["restore"]],
    ["close", ["close", "worker-brave-otter"]],
  ])("a %s refuses it", async (_, args) => {
    const r = await spawn([...args, "--reports-to", "planner"], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--reports-to is for a worker")
    expect(placing(r)).toEqual([])
  })
})

describe("--check runs the gates and starts nothing", () => {
  test("a start that would pass prints ok and touches neither herdr nor the roster", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "brief-x.md", "--check"], [])
    expect(r.code).toBe(0)
    expect(r.out).toContain("ok: worker-brave-otter can start")
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
  })

  test("the name a live session holds passes, since the switch closes it next", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "brief-x.md", "--check"],
      [{ name: "worker-brave-otter", pid: 5002 }],
    )
    expect(r.code).toBe(0)
    expect(placing(r)).toEqual([])
  })

  test("a column beside a herdr pane checks herdr, opening nothing", async () => {
    const r = await spawn(
      ["column", "lead", "planner", "dispatcher", "w1:p2", "handoff.md", "--check"],
      [],
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain("ok: planner can start")
    expect(herdrCalls(r).map((c) => c[0])).toEqual(["--version", "status"])
    expect(placing(r)).toEqual([])
  })

  test("a column beside a cmux surface:1 refuses, naming #2076", async () => {
    const r = await spawn(
      ["column", "lead", "planner", "dispatcher", "surface:1", "handoff.md", "--check"],
      [],
    )
    expect(r.code).toBe(1)
    expect(r.out).not.toContain("can start")
    expect(r.err).toContain("surface:1 is a cmux surface, and spawn.sh starts nothing in cmux")
    expect(r.cmux).toBeUndefined()
  })

  test("a gate that refuses still refuses", async () => {
    // an unreadable usage.json refuses; a missing one, never written yet, passes
    const r = await spawn(["worker", "worker-brave-otter", "brief-x.md", "--check"], [], {
      USAGE_JSON: "{ nope",
    })
    expect(r.code).not.toBe(0)
    expect(r.out).not.toContain("can start")
  })
})

describe("--model picks the Claude model a session runs on", () => {
  const command = launchAfterRm
  const MODELS = "claude-opus-5-5, claude-fable-5-1, claude-sonnet-5-5 or claude-haiku-5-5"
  const claudePin = { name: "worker-brave-otter", backend: "claude" }

  test.each([
    {
      label: "--model claude-sonnet-5-5",
      args: ["worker", "worker-brave-otter", "b.md", "--model", "claude-sonnet-5-5"],
      model: "claude-sonnet-5-5",
    },
    {
      label: "--model claude-haiku-5-5 before the mode",
      args: ["--model", "claude-haiku-5-5", "runner", "runner-calm-heron", "b.md"],
      model: "claude-haiku-5-5",
    },
    {
      label: "--model claude-opus-5-5 on a column",
      args: ["column", "probe", "probe-x", "ops", "w1:p2", "r.md", "--model", "claude-opus-5-5"],
      model: "claude-opus-5-5",
    },
    {
      label: "--model claude-fable-5-1",
      args: ["worker", "worker-brave-otter", "b.md", "--model", "claude-fable-5-1"],
      model: "claude-fable-5-1",
    },
    {
      label: "no --model",
      args: ["worker", "worker-brave-otter", "b.md"],
      model: "claude-opus-5-5",
    },
  ])("$label launches on $model", async ({ args, model }) => {
    const r = await spawn([...args], [])
    expect(r.code).toBe(0)
    expect(command(r).split(" --model ")).toHaveLength(2)
    expect(command(r)).toContain(` --model ${model} --effort high `)
    expect(command(r)).not.toContain("ANTHROPIC_BASE_URL")
  })

  test.each([
    {
      label: "an unknown id",
      args: ["worker", "worker-a", "b.md", "--model", "claude-opus-4"],
      says: `--model takes ${MODELS}, not claude-opus-4`,
    },
    {
      label: "an empty value",
      args: ["worker", "worker-a", "b.md", "--model", ""],
      says: `--model takes one of ${MODELS}, once`,
    },
    {
      label: "a missing value",
      args: ["worker", "worker-a", "b.md", "--model"],
      says: `--model takes one of ${MODELS}, once`,
    },
    {
      label: "a value that starts with --",
      args: ["worker", "worker-a", "b.md", "--model", "--check"],
      says: '--model needs a value; "--check" starts with --',
    },
    {
      label: "a second --model",
      args: [
        "worker",
        "worker-a",
        "b.md",
        "--model",
        "claude-sonnet-5-5",
        "--model",
        "claude-haiku-5-5",
      ],
      says: `--model takes one of ${MODELS}, once`,
    },
  ])("$label is refused before herdr runs", async ({ args, says }) => {
    const r = await spawn([...args], [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain(says)
  })

  test("--model beside --backend glm is refused, since GLM maps every model itself", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm", "--model", "claude-sonnet-5-5"],
      [],
    )
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("a session on GLM takes no --model")
  })

  test("--model on the resume of a session pinned to glm is refused too", async () => {
    const r = await spawn(
      ["resume", "worker-brave-otter", root, "--model", "claude-sonnet-5-5"],
      [],
      {},
      undefined,
      { name: "worker-brave-otter", backend: "glm" },
    )
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("a session on GLM takes no --model")
  })

  test("a resume takes --model afresh: on Sonnet with it, on Opus without, and records no model", async () => {
    const sonnet = await spawn(
      ["resume", "worker-brave-otter", root, "--model", "claude-sonnet-5-5"],
      [],
      {},
      undefined,
      claudePin,
    )
    expect(sonnet.code).toBe(0)
    expect(command(sonnet)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume worker-brave-otter -n worker-brave-otter --model claude-sonnet-5-5 --effort high ",
    )
    const plain = await spawn(["resume", "worker-brave-otter", root], [], {}, undefined, claudePin)
    expect(plain.code).toBe(0)
    expect(command(plain)).toContain(" --model claude-opus-5-5 --effort high ")
    // A start on Sonnet leaves only the backend pin behind, so nothing carries the model to a resume.
    const start = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--model", "claude-sonnet-5-5"],
      [],
    )
    expect(start.code).toBe(0)
    const pins = join(start.home, ".playground", "backends")
    expect(readdirSync(pins)).toEqual(["worker-brave-otter"])
    expect(readFileSync(join(pins, "worker-brave-otter"), "utf8")).toBe("claude\n")
  })

  test.each([
    {
      label: "a worker",
      args: ["worker", "worker-brave-otter", "b.md"],
      name: "worker-brave-otter",
    },
    {
      label: "a planner",
      args: ["column", "lead", "planner", "dispatcher", "w1:p2", "handoff.md"],
      name: "planner",
    },
  ])("$label passes --check on claude-fable-5-1", async ({ args, name }) => {
    const r = await spawn([...args, "--model", "claude-fable-5-1", "--check"], [])
    expect(r.code).toBe(0)
    expect(r.out).toContain(`ok: ${name} can start`)
    expect(placing(r)).toEqual([])
  })

  test("the usage header names --model and its four ids", async () => {
    const r = await spawn([], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("--model <id>")
    expect(r.err).toContain("claude-opus-5-5")
    expect(r.err).toContain("claude-fable-5-1")
    expect(r.err).toContain("claude-sonnet-5-5")
    expect(r.err).toContain("claude-haiku-5-5")
  })

  // A checker never runs on a fast small model: a checker's verdict gates a merge, so it stays on Opus.
  const checkerColumn = (role: string, name: string): string[] => [
    "column",
    role,
    name,
    "worker-x",
    "w1:p2",
    "r.md",
  ]
  test.each([
    {
      label: "a reviewer column on claude-sonnet-5-5",
      args: [...checkerColumn("reviewer", "reviewer-x"), "--model", "claude-sonnet-5-5"],
      role: "reviewer",
      pin: undefined,
    },
    {
      label: "a tester column on claude-haiku-5-5",
      args: [...checkerColumn("tester", "tester-x"), "--model", "claude-haiku-5-5"],
      role: "tester",
      pin: undefined,
    },
    {
      label: "a reviewer column on claude-fable-5-1",
      args: [...checkerColumn("reviewer", "reviewer-x"), "--model", "claude-fable-5-1"],
      role: "reviewer",
      pin: undefined,
    },
    {
      label: "a tester column on claude-fable-5-1",
      args: [...checkerColumn("tester", "tester-x"), "--model", "claude-fable-5-1"],
      role: "tester",
      pin: undefined,
    },
    {
      label: "a reviewer's resume on claude-haiku-5-5",
      args: ["resume", "reviewer-x", root, "--model", "claude-haiku-5-5"],
      role: "reviewer",
      pin: { name: "reviewer-x", backend: "claude" },
    },
    {
      label: "a tester's resume on claude-sonnet-5-5",
      args: ["resume", "tester-x", root, "--model", "claude-sonnet-5-5"],
      role: "tester",
      pin: { name: "tester-x", backend: "claude" },
    },
  ])("$label is refused before herdr runs, naming why", async ({ args, role, pin }) => {
    const r = await spawn([...args], [], {}, undefined, pin)
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain(`a ${role} runs on claude-opus-5-5, since its verdict gates a merge`)
  })

  test.each([
    {
      label: "a reviewer column",
      args: [...checkerColumn("reviewer", "reviewer-x"), "--model", "claude-opus-5-5"],
      pin: undefined,
    },
    {
      label: "a tester's resume",
      args: ["resume", "tester-x", root, "--model", "claude-opus-5-5"],
      pin: { name: "tester-x", backend: "claude" },
    },
  ])("$label takes --model claude-opus-5-5", async ({ args, pin }) => {
    const r = await spawn([...args], [], {}, undefined, pin)
    expect(r.code).toBe(0)
    expect(command(r)).toContain(" --model claude-opus-5-5 --effort high ")
  })

  // The models are settings: a render set that sets them changes what spawn.sh takes and launches, with no edit to spawn.sh.
  const withModels = (values: Record<string, unknown>) => ({
    SETTINGS_JSON: JSON.stringify(values),
  })

  test("a model models.claude adds launches, and models.default names the one a start gives none", async () => {
    const env = withModels({
      "models.claude": ["claude-opus-5-5", "claude-opus-6"],
      "models.default": "claude-opus-6",
    })
    const added = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--model", "claude-opus-6"],
      [],
      env,
    )
    expect(added.code, added.err).toBe(0)
    expect(command(added)).toContain(" --model claude-opus-6 --effort high ")
    const plain = await spawn(["worker", "worker-brave-otter", "b.md"], [], env)
    expect(command(plain)).toContain(" --model claude-opus-6 --effort high ")
    const gone = await spawn(
      ["worker", "worker-a", "b.md", "--model", "claude-sonnet-5-5"],
      [],
      env,
    )
    expect(gone.err).toContain(
      "--model takes claude-opus-5-5 or claude-opus-6, not claude-sonnet-5-5",
    )
  })

  test("a checker runs on models.checker, with no --model and with it", async () => {
    const env = withModels({
      "models.checker": "claude-opus-6",
      "models.claude": ["claude-opus-5-5", "claude-opus-6"],
    })
    const plain = await spawn(checkerColumn("reviewer", "reviewer-x"), [], env)
    expect(plain.code, plain.err).toBe(0)
    expect(command(plain)).toContain(" --model claude-opus-6 --effort high ")
    const opus = await spawn(
      [...checkerColumn("tester", "tester-x"), "--model", "claude-opus-5-5"],
      [],
      env,
    )
    expect(opus.err).toContain("a tester runs on claude-opus-6, since its verdict gates a merge")
  })

  test("models.glm is the model a GLM session runs on, its key under models.glmKeychainService", async () => {
    const env = withModels({
      "models.glm": "glm-6-flash",
      "models.glmKeychainService": "acme-glm",
    })
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], env)
    expect(r.code, r.err).toBe(0)
    expect(command(r)).toContain(" --model 'glm-6-flash[1m]' --effort high ")
    expect(command(r)).toContain("ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-6-flash ")
    expect(command(r)).toContain('tk="$(security find-generic-password -s acme-glm -a zai -w)"')
    expect(r.security).toEqual(["find-generic-password -s acme-glm -a zai"])
  })
})

// a session's kind lives in the roster, so a name that carries no role still reads as what it is.
describe("the roster's kind", () => {
  const rosterOf = (agents: object[]) =>
    JSON.stringify({ agents, updatedAt: "2026-10-18T00:00:00Z" })

  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<{ args: string[]; kind: string }>([
    { args: ["worker", "worker-brave-otter", "b.md"], kind: "kind=worker" },
    { args: ["runner", "runner-brave-otter", "b.md"], kind: "kind=runner" },
    {
      args: ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"],
      kind: "kind=tester",
    },
    { args: ["column", "probe", "probe-x", "ops", "w1:p2", "p.md"], kind: "kind=probe" },
    { args: ["column", "lead", "builder", "dispatcher", "w1:p2", "l.md"], kind: "kind=builder" },
    { args: ["column", "lead", "ops", "dispatcher", "w1:p2", "l.md"], kind: "kind=ops" },
    {
      args: ["column", "lead", "planner", "dispatcher", "w1:p2", "l.md"],
      kind: "kind=planner",
    },
  ])("every start writes the kind its mode gives: $kind", async ({ args, kind }) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(0)
    expect(r.roster?.[2]).toBe(kind)
  })

  const config = mkdtempSync(join(scratch, "name-"))
  const named = (kind: string): string =>
    Bun.spawnSync(["bun", join(root, "packages", "scripts", "src", "name", "index.ts"), kind], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: config },
      stderr: "pipe",
      stdout: "pipe",
    })
      .stdout.toString()
      .trim()
  // one test per start, so each start has the whole timeout to itself on a loaded runner
  test.each<[string, (name: string, worker: string) => string[]]>([
    ["worker", (name) => ["worker", name, "b.md"]],
    ["runner", (name) => ["runner", name, "b.md"]],
    ["reviewer", (name, worker) => ["column", "reviewer", name, worker, "w1:p2", "r.md"]],
    ["tester", (name, worker) => ["column", "tester", name, worker, "w1:p2", "t.md"]],
    ["probe", (name) => ["column", "probe", name, "ops", "w1:p2", "p.md"]],
  ])(
    "a spawn of each kind under the name bun run name gives writes that name and its kind (#966): %s",
    async (kind, argsOf) => {
      const name = named(kind)
      const checker = kind === "reviewer" || kind === "tester"
      const worker = checker ? named("worker") : ""
      const args = argsOf(name, worker)
      expect(name).toMatch(new RegExp(`^[${ID_ALPHABET}]{6}-${kind}$`))
      const r = await spawn(args, [])
      expect(r.code, args.join(" ")).toBe(0)
      expect(r.roster?.slice(0, 3)).toEqual(["set", name, `kind=${kind}`])
      // a checker of an id-named worker links to it with no roster entry to read, and a probe with no what in its name is titled by its spawner
      if (checker) expect(r.roster).toContain(`worker=${worker}`)
      if (kind === "probe") expect(r.roster).toContain("title=Probe of ops")
    },
  )

  test("every Bash and Python reader of an <id>-<kind> name spells ID_ALPHABET as kinds.ts does", () => {
    for (const file of [
      "scripts/ops/run-slot.sh",
      "scripts/ops/unstick/run.py",
      "scripts/spawn.sh",
    ])
      expect(readFileSync(join(root, file), "utf8"), file).toContain(`[${ID_ALPHABET}]{6}-`)
  })

  test.each([
    [
      "worker",
      ["worker", "k3m9px-reviewer", "b.md"],
      "k3m9px-reviewer reads as a reviewer, not a worker",
    ],
    [
      "runner",
      ["runner", "k3m9px-worker", "b.md"],
      "k3m9px-worker reads as a worker, not a runner",
    ],
    [
      "column",
      ["column", "reviewer", "k3m9px-worker", "worker-a", "w1:p2", "r.md"],
      "k3m9px-worker reads as a worker, not a reviewer",
    ],
  ])("a %s start refuses a name that reads as another kind, naming both", async (_, args, why) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${why}: bun run name `)
    expect(placing(r)).toEqual([])
  })

  test.each([
    [
      "worker",
      ["worker", "anne-liaison", "b.md"],
      "anne-liaison gives no kind: bun run name worker",
    ],
    ["runner", ["runner", "night-watch", "b.md"], "night-watch gives no kind: bun run name runner"],
    [
      "column",
      ["column", "tester", "herdr-check", "worker-a", "w1:p2", "t.md"],
      "herdr-check gives no kind: bun run name tester",
    ],
  ])("a %s start refuses a new name that gives no kind", async (_, args, why) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain(`${why} gives one`)
    expect(placing(r)).toEqual([])
  })

  // until the managers start by kind (a later PR), today's names still start them
  test.each<{ args: string[]; kind: string }>([
    {
      args: ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"],
      kind: "dispatcher",
    },
    { args: ["column", "lead", "builder", "dispatcher", "w1:p2", "l.md"], kind: "builder" },
    { args: ["column", "lead", "ops", "dispatcher", "w1:p2", "l.md"], kind: "ops" },
    { args: ["column", "lead", "planner", "dispatcher", "w1:p2", "l.md"], kind: "planner" },
    { args: ["manager", "optimizer", "o.md"], kind: "optimizer" },
    { args: ["manager", "dispatcher-2", "b.md", "--backend", "glm"], kind: "dispatcher" },
  ])("a manager's own name still starts it: $args.2 as a $kind", async ({ args, kind }) => {
    const r = await spawn(args, [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster?.[2]).toBe(`kind=${kind}`)
  })

  test("a resume keeps a name that gives no kind, reading its kind from the roster", async () => {
    const r = await spawn(
      ["resume", "anne-liaison", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          { kind: "worker", name: "anne-liaison", role: "worker", status: "working", task: "t" },
        ]),
      },
      undefined,
      { name: "anne-liaison", backend: "claude" },
    )
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume anne-liaison ",
    )
    expect(r.roster?.slice(0, 3)).toEqual(["set", "anne-liaison", "kind=worker"])
  })

  test("a resume keeps the roster's kind over the name's, and reads an <id>-<kind> name with no entry by its last word", async () => {
    const roster = await spawn(
      ["resume", "k3m9px-worker", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          { kind: "reviewer", name: "k3m9px-worker", role: "worker", status: "working", task: "t" },
        ]),
      },
      undefined,
      { name: "k3m9px-worker", backend: "claude" },
    )
    expect(roster.code).toBe(0)
    expect(launchAfterRm(roster)).toStartWith(
      "(env PLAYGROUND_ROLE=reviewer claude --resume k3m9px-worker ",
    )
    const bare = await spawn(["resume", "k3m9px-tester", root], [], {}, undefined, {
      name: "k3m9px-tester",
      backend: "claude",
    })
    expect(bare.code).toBe(0)
    expect(launchAfterRm(bare)).toStartWith(
      "(env PLAYGROUND_ROLE=tester claude --resume k3m9px-tester ",
    )
    expect(bare.roster?.slice(0, 3)).toEqual(["set", "k3m9px-tester", "kind=tester"])
  })

  test("a resume reads the roster's kind first, so a name with no role prefix reopens as its kind", async () => {
    const r = await spawn(
      ["resume", "k3v9q2-wizard", root],
      [],
      {
        ROSTER_JSON: rosterOf([
          {
            kind: "reviewer",
            name: "k3v9q2-wizard",
            role: "worker",
            status: "working",
            task: "t",
          },
        ]),
      },
      undefined,
      { name: "k3v9q2-wizard", backend: "claude" },
    )
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toStartWith(
      "(env PLAYGROUND_ROLE=reviewer claude --resume k3v9q2-wizard ",
    )
    expect(r.roster?.slice(0, 3)).toEqual(["set", "k3v9q2-wizard", "kind=reviewer"])
  })

  test("a resume with no kind reads the old name as today, and one with neither is refused", async () => {
    const old = await spawn(["resume", "worker-greed", root], [], {}, undefined, {
      name: "worker-greed",
      backend: "claude",
    })
    expect(launchAfterRm(old)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume worker-greed ",
    )
    expect(old.roster?.slice(0, 3)).toEqual(["set", "worker-greed", "kind=worker"])
    const offList = await spawn(
      ["resume", "worker-greed", root],
      [],
      { ROSTER_JSON: rosterOf([{ kind: "wizard", name: "worker-greed" }]) },
      undefined,
      { name: "worker-greed", backend: "claude" },
    )
    expect(launchAfterRm(offList)).toStartWith(
      "(env PLAYGROUND_ROLE=worker claude --resume worker-greed ",
    )
    const none = await spawn(["resume", "k3v9q2-wizard", root, "--backend", "claude"], [])
    expect(none.code).toBe(1)
    expect(none.err).toContain(
      "k3v9q2-wizard is not a factory session's name, and the roster gives it no kind",
    )
  })

  test("a checker whose entry holds a pr takes its title too, since roster.ts sets one there (#2161)", async () => {
    const r = await spawn(["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"], [], {
      ROSTER_JSON: rosterOf([
        { name: "reviewer-x", pr: "https://github.com/o/r/pull/1", task: "t", title: "" },
      ]),
    })
    expect(r.code).toBe(0)
    expect(r.roster).toContain("title=Plain test work")
  })

  test("a checker's worker link is written for a worker the roster gives the worker kind", async () => {
    const r = await spawn(
      ["column", "reviewer", "reviewer-x", "x7mh4d-worker", "w1:p2", "r.md"],
      [],
      {
        ROSTER_JSON: rosterOf([{ kind: "worker", name: "x7mh4d-worker" }]),
      },
    )
    expect(r.code).toBe(0)
    expect(r.roster).toContain("worker=x7mh4d-worker")
    const lead = await spawn(["column", "reviewer", "reviewer-x", "builder", "w1:p2", "r.md"], [])
    expect(lead.roster?.some((arg) => arg.startsWith("worker="))).toBe(false)
  })
})

describe("manager starts the first dispatcher in a workspace of its own", () => {
  test("on this machine's own login, as the first dispatcher, talking to the owner and reporting to no session", async () => {
    const r = await spawn(["manager", "dispatcher", "b.md"], [])
    expect(r.code, r.err).toBe(0)
    expect(r.roster).toContain("kind=dispatcher")
    expect(r.roster).not.toContain("slot=2")
    const launch = launchAfterRm(r)
    expect(launch).toContain(
      "You are dispatcher, the Playground factory's dispatcher; you work with the owner, who talks to you here and in the Dashboard's chat.",
    )
    expect(launch).not.toContain("you report to")
    expect(launch).not.toContain("briefs you")
  })

  test("the second dispatcher still needs GLM or a second account", async () => {
    const r = await spawn(["manager", "dispatcher-2", "b.md"], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("dispatcher-2, the second dispatcher, runs on --backend glm")
  })
})
