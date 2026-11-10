import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { managerOf } from "@packages/config/kinds"

import type { Run } from "../ops-tick/tick"

// The battery check ops-awake runs each minute: while the charge falls the Ops lead posts the owner two Inbox items, each at most once a fall, and nothing above 10%: an orange ask at 10% or less on battery, and a red alert at 5% or less on battery or on a charger losing to the load. At that red mark it pauses the heavy runs through run-slot.battery, which it lifts on the check that sees the charge rise. Once the charge stops falling it closes both items, the alert by resolving it and an ask already closed (cleared, denied, acked) by its read alone, drops one deleted from the Inbox, and re-arms. It returns a line for ops only when a post or a close fails, at most every 15 minutes.

export const ORANGE = 10
export const RED = 5
const BACK = "The Mac is back on power"
const RETRY_MS = 15 * 60_000
// the pause's fail-safe: each check at the red mark pushes its expiry on, so it lapses only once ops-awake has stopped
const PAUSE_MS = 10 * 60_000
const PAUSED = "heavy runs wait until the charge rises"

export type Reading = { ac: boolean; falling: boolean; pct: number | null }
export type BatteryState = { alert?: string; ask?: string; failedAt?: number; reading?: Reading }

// Pure: pmset -g batt's answer as its power source, its charge, and whether the charge falls. On AC a charger losing to the load shows no state word of its own, so a charge lower than the last check's, with no charging word, falls; pmset gives whole percents, so a reading level with the last keeps the last's trend.
export const batteryOf = (pmset: string, last?: Reading): Reading => {
  const word = /(\d+)%;/.exec(pmset)
  const pct = word ? Number(word[1]) : null
  const ac = !pmset.includes("Battery Power")
  let falling = false
  if (/\bdischarging\b/.test(pmset)) falling = true
  else if (/;\s*(charging|charged|finishing charge)\b/.test(pmset)) falling = false
  else if (ac && last?.ac && pct !== null && last.pct !== null)
    falling = pct === last.pct ? last.falling : pct < last.pct
  return { ac, falling, pct }
}

// Pure: the two items, by the charge they post at; on AC the alert names the charger losing to the load.
export const itemsOf = (pct: number, from: string, ac = false) => ({
  alert: {
    from,
    kind: "update",
    preview: { outcome: "alert" },
    title: ac
      ? `The Mac's battery is at ${pct}% on the charger: the charger is losing to the load, and ${PAUSED}`
      : `The Mac's battery is at ${pct}%: plug it in now or it shuts down, and ${PAUSED}`,
  },
  ask: {
    from,
    preview: { text: "Approve: I plugged in the Mac.\nDeny: I can't right now.", type: "ask" },
    title: `Plug in the Mac: its battery is at ${pct}%`,
  },
})

type Item = {
  answer?: { ackedAt?: unknown; choice?: string }
  from?: string
  kind?: string
  status?: string
}

// The ask call that closes a battery item back on power; null for one already closed, undefined for an item that did not read.
const closingCall = (id: string, item: Item): string[] | null | undefined => {
  // the red alert is an update, posted at status done, which only its poster's resolve closes
  if (item.kind === "update" && item.from)
    return item.answer?.choice === "resolved"
      ? null
      : ["resolve", id, "--by", item.from, "--note", BACK]
  // an answer its poster acked (a reply stays open once acked) is closed, and settle or ack would be refused
  if (item.answer?.ackedAt) return null
  if (item.status === "open") return ["settle", id, "--note", BACK]
  if (item.status === "approved") return ["ack", id, "--no-link", BACK]
  return item.status ? null : undefined
}

const isoOf = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`

// run-slot.battery, the ops switch run-slot holds every heavy run on: written at the red mark's charge in its line's shape (scripts/ops/README.md's Ops switches), and lifted by its .lifted move once the mark ends
const pauseAt = async (ops: string, now: Date, pct: number | null) => {
  const path = join(ops, "run-slot.battery")
  if (pct !== null) {
    const at = now.getTime()
    await mkdir(ops, { recursive: true })
    await writeFile(
      `${path}.tmp`,
      `ops-awake ${isoOf(at)} ${isoOf(at + PAUSE_MS)} the battery is at ${pct}% and falling, so ${PAUSED}\n`,
    )
    await rename(`${path}.tmp`, path)
  } else if (
    await access(path).then(
      () => true,
      () => false,
    )
  )
    await rename(path, `${path}.lifted-${isoOf(now.getTime()).replace(/[-:]/g, "")}`)
}

export const checkBattery = async (ctx: {
  now: Date
  ops: string
  repo: string
  run: Run
}): Promise<string | undefined> => {
  const pmset = await ctx.run(["pmset", "-g", "batt"], 20_000)
  if (pmset.code !== 0) return undefined
  const path = join(ctx.ops, "awake", "battery-state.json")
  const state: BatteryState = await readFile(path, "utf8")
    .then((text) => JSON.parse(text) as BatteryState)
    .catch(() => ({}))
  const reading = batteryOf(pmset.out, state.reading)
  const { ac, falling, pct } = reading
  state.reading = reading
  const ask = (args: string[], stdin?: string) =>
    ctx.run(["bun", "run", "--silent", "--cwd", ctx.repo, "ask", ...args], 120_000, stdin)
  const failures: string[] = []
  if (falling && pct !== null) {
    const roster = await readFile(join(ctx.ops, "..", "roster.json"), "utf8")
      .then((text) => JSON.parse(text) as { agents?: unknown })
      .catch(() => null)
    const items = itemsOf(pct, managerOf(roster?.agents, "ops"), ac)
    for (const [key, at] of [
      ["ask", ORANGE],
      ["alert", RED],
    ] as const) {
      // the orange ask says to plug in, which a Mac on AC already is
      if (pct > at || state[key] || (key === "ask" && ac)) continue
      const posted = await ask(["new"], JSON.stringify(items[key]))
      const id = posted.out
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^[0-9a-f-]{36}$/.test(line))
      if (posted.code === 0 && id) state[key] = id
      else failures.push(`${key} not posted to the Inbox: ${posted.out.trim().slice(-200)}`)
    }
  } else if (!falling) {
    for (const key of ["ask", "alert"] as const) {
      const id = state[key]
      if (!id) continue
      // the read marks any answer read, which closes a clear, a deny or a discard; the JSON runs from its first brace to its last, so a line ask writes to stderr around it reads past
      const got = await ask(["get", id, "--ack"])
      let item: Item = {}
      try {
        item = JSON.parse(got.out.slice(got.out.indexOf("{"), got.out.lastIndexOf("}") + 1))
      } catch {}
      const closing = got.out.includes("no inbox item") ? null : closingCall(id, item)
      const closed = closing === null ? { code: 0, out: "" } : closing && (await ask(closing))
      if (closed && closed.code === 0) delete state[key]
      else
        failures.push(
          `battery item ${id} not closed: ${(closed?.out ?? got.out).trim().slice(-200)}`,
        )
    }
  }
  await pauseAt(ctx.ops, ctx.now, falling && pct !== null && pct <= RED ? pct : null)
  let line: string | undefined
  if (failures.length && ctx.now.getTime() - (state.failedAt ?? 0) >= RETRY_MS) {
    state.failedAt = ctx.now.getTime()
    line = `battery alert: ${failures.join("; ")}`
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify(state))
  await rename(`${path}.tmp`, path)
  return line
}
