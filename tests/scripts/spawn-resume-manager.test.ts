import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("a resume names the manager the roster holds, else the one its start recorded", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
  const recorded = (home: string) => {
    mkdirSync(join(home, ".playground", "resume"), { recursive: true })
    writeFileSync(
      join(home, ".playground", "resume", "worker-x.prompt"),
      "You are worker-x, a worker in the Playground factory; you report to builder. Load the playbook skill first.",
    )
  }
  const roster = (row: object) =>
    JSON.stringify({ agents: [{ name: "worker-x", role: "worker", status: "working", ...row }] })

  test.each([
    [
      "the roster's reportsTo, over the prompt's builder",
      { reportsTo: "planner", lead: "ops" },
      "planner",
    ],
    ["the roster's lead, with no reportsTo", { lead: "ops" }, "ops"],
    ["the recorded prompt's manager, with neither", {}, "builder"],
    [
      "the recorded prompt's manager, over a reportsTo that is not a session name",
      { reportsTo: "Bad Name" },
      "builder",
    ],
  ])("%s", async (_, row, manager) => {
    const r = await spawn(
      ["resume", "worker-x", root, id],
      [],
      { ROSTER_JSON: roster(row) },
      undefined,
      { name: "worker-x", backend: "claude" },
      recorded,
    )
    expect(r.code).toBe(0)
    expect(launchAfterRm(r)).toContain(
      `"You are worker-x, resumed after a restart; you report to ${manager}. Act on the after-resume instruction in your context first, then carry on."`,
    )
  })
})
