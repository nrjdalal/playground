import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { batteryOf, checkBattery } from "../../../../../packages/scripts/src/ops-awake/battery"

const scratch = mkdtempSync(join(tmpdir(), "ops-awake-battery-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ON_BATTERY = (pct: number) =>
  `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${pct}%; discharging; 0:20 remaining present: true\n`
const ON_AC =
  "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t40%; charging; present: true\n"
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

// A Mac whose pmset answers the given text, and whose ask command posts with the next id and reads each item at the status given.
const machine = (name: string) => {
  const data = join(scratch, name)
  const ops = join(data, "ops")
  mkdirSync(ops, { recursive: true })
  writeFileSync(
    join(data, "roster.json"),
    JSON.stringify({ agents: [{ kind: "ops", name: "b7k2mq-ops", status: "working" }] }),
  )
  const calls: { args: string[]; stdin?: unknown }[] = []
  let pmset = ""
  let posted = 0
  const status: Record<string, string> = {}
  const run = async (argv: string[], _timeout?: number, stdin?: string) => {
    if (argv[0] === "pmset") return { code: 0, out: pmset }
    const args = argv.slice(argv.indexOf("ask") + 1)
    calls.push({ args, ...(stdin ? { stdin: JSON.parse(stdin) } : {}) })
    if (args[0] === "new") return { code: 0, out: `${ID(++posted)}\n` }
    if (args[0] === "get" && args.length === 2)
      return { code: 0, out: JSON.stringify({ status: status[args[1]!] }) }
    return { code: 0, out: "" }
  }
  const check = (at = 0) => checkBattery({ now: new Date(at), ops, repo: "/r", run })
  return {
    calls,
    check,
    ops,
    set: (text: string) => (pmset = text),
    status,
  }
}

test("pmset's answer reads as discharging and its charge", () => {
  expect(batteryOf(ON_BATTERY(9))).toEqual({ discharging: true, pct: 9 })
  expect(batteryOf(ON_AC)).toEqual({ discharging: false, pct: 40 })
})

test("discharging posts the orange ask at 10% and the red alert at 5%, each once, from the Ops lead", async () => {
  const mac = machine("drain")
  mac.set(ON_BATTERY(11))
  expect(await mac.check()).toBeUndefined()
  expect(mac.calls).toEqual([])
  mac.set(ON_BATTERY(10))
  await mac.check()
  await mac.check()
  expect(mac.calls).toEqual([
    {
      args: ["new"],
      stdin: {
        from: "b7k2mq-ops",
        preview: { text: "Approve: I plugged in the Mac.\nDeny: I can't right now.", type: "ask" },
        title: "Plug in the Mac: its battery is at 10%",
      },
    },
  ])
  mac.set(ON_BATTERY(5))
  await mac.check()
  expect(mac.calls.slice(1)).toEqual([
    {
      args: ["new"],
      stdin: {
        from: "b7k2mq-ops",
        kind: "update",
        preview: { outcome: "alert" },
        title: "The Mac's battery is at 5%: plug it in now or it shuts down",
      },
    },
  ])
  expect(JSON.parse(readFileSync(join(mac.ops, "awake", "battery-state.json"), "utf8"))).toEqual({
    alert: ID(2),
    ask: ID(1),
  })
})

test("back on power, an open ask is settled, an approved one acked, and the state re-arms", async () => {
  const mac = machine("back")
  mac.set(ON_BATTERY(4))
  await mac.check()
  mac.status[ID(1)] = "approved"
  mac.status[ID(2)] = "open"
  mac.set(ON_AC)
  mac.calls.length = 0
  await mac.check()
  expect(mac.calls.map((c) => c.args)).toEqual([
    ["get", ID(1)],
    ["ack", ID(1), "--no-link", "The Mac is back on power"],
    ["get", ID(2)],
    ["settle", ID(2), "--note", "The Mac is back on power"],
  ])
  expect(JSON.parse(readFileSync(join(mac.ops, "awake", "battery-state.json"), "utf8"))).toEqual({})
})

test("a post that fails is told to ops once in 15 minutes, and tried again each minute", async () => {
  const mac = machine("refused")
  const failing = async (argv: string[]) =>
    argv[0] === "pmset" ? { code: 0, out: ON_BATTERY(8) } : { code: 1, out: "no database" }
  const check = (at: number) =>
    checkBattery({ now: new Date(at), ops: mac.ops, repo: "/r", run: failing })
  expect(await check(1_000_000)).toBe("battery alert: ask not posted to the Inbox: no database")
  expect(await check(1_060_000)).toBeUndefined()
  expect(await check(1_000_000 + 15 * 60_000)).toStartWith("battery alert:")
})

test("a Mac with no pmset is left alone", async () => {
  const none = async () => ({ code: 127, out: "" })
  expect(
    await checkBattery({ now: new Date(), ops: join(scratch, "none"), repo: "/r", run: none }),
  ).toBeUndefined()
})
