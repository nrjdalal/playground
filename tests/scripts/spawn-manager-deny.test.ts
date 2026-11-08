import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them.
setDefaultTimeout(40_000)

// a manager hands every build, read or research to a worker session (playbook's **workers**), so its built settings deny the Agent and Workflow tools, which a bare deny takes out of the session's tools; every other session keeps both, a reviewer's code-review sub-agents among them (#1503)
describe("a manager's settings deny the Agent and Workflow tools", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
  const settingsOf = (r: { home: string }, file: string) => join(r.home, ".playground", file)
  const builtOf = (r: { home: string }, file: string) =>
    JSON.parse(readFileSync(settingsOf(r, file), "utf8")) as { permissions?: { deny?: string[] } }
  const roster = JSON.stringify({
    agents: [
      { kind: "builder", name: "x7mh4d-builder", role: "manager", status: "working", task: "t" },
    ],
  })

  test.each([
    [
      "a lead",
      ["column", "lead", "planner", "dispatcher", "w1:p2", "h.md"],
      "factory-settings-400k-memory-planner.json",
    ],
    [
      "a lead by its roster kind",
      ["column", "lead", "x7mh4d-builder", "dispatcher", "w1:p2", "l.md"],
      "factory-settings-400k-memory-x7mh4d-builder.json",
    ],
    [
      "the dispatcher",
      ["column", "dispatcher", "dispatcher", "ops", "w1:p2", "h.md"],
      "factory-settings-400k-memory-dispatcher.json",
    ],
    ["an optimizer", ["manager", "optimizer", "b.md"], "factory-settings-manager-400k.json"],
    [
      "the second dispatcher on GLM",
      ["manager", "dispatcher-2", "b.md", "--backend", "glm"],
      "factory-settings-glm-manager-400k.json",
    ],
  ])("%s starts with them denied, in a file of its own", async (_, args, file) => {
    const r = await spawn(args, [], { ROSTER_JSON: roster })
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).permissions?.deny).toEqual(["Agent", "Workflow"])
  })

  test("a resumed lead keeps them denied", async () => {
    const r = await spawn(["resume", "builder", root, id], [], { ROSTER_JSON: roster }, undefined, {
      name: "builder",
      backend: "claude",
    })
    expect(r.code, r.err).toBe(0)
    const file = "factory-settings-400k-memory-builder.json"
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    expect(builtOf(r, file).permissions?.deny).toEqual(["Agent", "Workflow"])
  })

  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"], "factory-settings-400k.json"],
    ["a runner", ["runner", "runner-calm-heron", "b.md"], "factory-settings-400k.json"],
    [
      "a reviewer",
      ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md", "--pr", "1"],
      "factory-settings-400k.json",
    ],
    [
      "a worker on GLM",
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm"],
      "factory-settings-glm-400k.json",
    ],
    ["a probe", ["probe", "probe-x", "ops", "p.md"], "factory-settings-sandbox-400k.json"],
  ])("%s keeps both tools", async (_, args, file) => {
    const r = await spawn(args, [], { ROSTER_JSON: roster })
    expect(r.code, r.err).toBe(0)
    expect(launchAfterRm(r)).toContain(` --settings ${settingsOf(r, file)} `)
    const deny = builtOf(r, file).permissions?.deny ?? []
    expect(deny).not.toContain("Agent")
    expect(deny).not.toContain("Workflow")
  })
})
