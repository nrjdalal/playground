import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { launchAfterRm, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("a resume names the manager the roster holds, else the one its start recorded", () => {
  const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"
  // Each start recorded a manager the roster has since moved off: builder for the worker, oldold-worker for the reviewer.
  const recorded = (name: string, manager: string) => (home: string) => {
    mkdirSync(join(home, ".playground", "resume"), { recursive: true })
    writeFileSync(
      join(home, ".playground", "resume", `${name}.prompt`),
      `You are ${name}, a session in the Playground factory; you report to ${manager}. Load the playbook skill first.`,
    )
  }
  const resume = async (name: string, kind: string, was: string, row: object) => {
    const agents = [
      { name, role: "worker", kind, status: "working", ...row },
      { name: "newnew-worker", role: "worker", kind: "worker", status: "working" },
      { name: "oldold-worker", role: "worker", kind: "worker", status: "working" },
    ]
    const r = await spawn(
      [
        "resume",
        name,
        root,
        id,
        ...(kind === "reviewer" || kind === "tester" ? ["--pr", "1"] : []),
      ],
      [],
      { ROSTER_JSON: JSON.stringify({ agents }) },
      undefined,
      { name, backend: "claude" },
      recorded(name, was),
    )
    expect(r.code).toBe(0)
    return launchAfterRm(r)
  }
  const told = (name: string, manager: string) =>
    `"You are ${name}, resumed after a restart; you report to ${manager}. Act on the after-resume instruction in your context first, then carry on."`

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
  ])("a worker: %s", async (_, row, manager) => {
    expect(await resume("worker-x", "worker", "builder", row)).toContain(told("worker-x", manager))
  })

  test.each([
    [
      "the roster's worker, over the prompt's old one",
      { worker: "newnew-worker" },
      "newnew-worker",
    ],
    [
      "the roster's worker, over its lead, the lead above that worker",
      { worker: "newnew-worker", lead: "ops" },
      "newnew-worker",
    ],
    ["the recorded prompt's worker, with no worker on the row", { lead: "ops" }, "oldold-worker"],
  ])("a reviewer: %s", async (_, row, manager) => {
    expect(await resume("abcdef-reviewer", "reviewer", "oldold-worker", row)).toContain(
      told("abcdef-reviewer", manager),
    )
  })
})
