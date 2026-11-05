import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { OLD } from "../session-names"
import { placing, script, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const lead = ["column", "lead", OLD.planner, OLD.dispatcher, "w1:p2", "handoff.md"]
const focus = (until: Date) => (home: string) =>
  writeFileSync(
    join(home, ".playground", "focus.json"),
    JSON.stringify({
      reason: "demo",
      session: "owner-desk",
      since: new Date(0).toISOString(),
      until: until.toISOString(),
    }),
  )

describe("focus holds every new session", () => {
  test("on, a start is refused, naming focus's session and its end", async () => {
    const until = new Date(Date.now() + 3_600_000)
    const r = await spawn(lead, [], {}, script, undefined, focus(until))
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`focus stands for owner-desk until ${until.toISOString()}`)
  })

  test("lapsed, past its end, the start goes on", async () => {
    const r = await spawn(lead, [], {}, script, undefined, focus(new Date(Date.now() - 60_000)))
    expect(r.code).toBe(0)
  })

  test("off, with no focus.json, the start goes on", async () => {
    expect((await spawn(lead, [])).code).toBe(0)
  })
})
