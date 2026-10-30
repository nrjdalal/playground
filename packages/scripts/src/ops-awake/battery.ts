import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { managerOf } from "@packages/config/kinds"

import type { Run } from "../ops-tick/tick"

// The battery check ops-awake runs each minute: the battery never holds work, so while the Mac discharges the Ops lead posts the owner two Inbox items, each at most once a discharge, and nothing above 10%: an orange ask at 10% or less and a red alert at 5% or less. Back on power it closes both and re-arms. It returns a line for ops only when a post or a close fails, at most every 15 minutes.

export const ORANGE = 10
export const RED = 5
const BACK = "The Mac is back on power"
const RETRY_MS = 15 * 60_000

export type BatteryState = { alert?: string; ask?: string; failedAt?: number }

// Pure: pmset -g batt's answer as whether the Mac runs on its battery and the charge it shows.
export const batteryOf = (pmset: string): { discharging: boolean; pct: number | null } => {
  const word = /(\d+)%;/.exec(pmset)
  return {
    discharging: pmset.includes("Battery Power") && pmset.includes("discharging"),
    pct: word ? Number(word[1]) : null,
  }
}

// Pure: the two items, by the charge they post at.
export const itemsOf = (pct: number, from: string) => ({
  alert: {
    from,
    kind: "update",
    preview: { outcome: "alert" },
    title: `The Mac's battery is at ${pct}%: plug it in now or it shuts down`,
  },
  ask: {
    from,
    preview: { text: "Approve: I plugged in the Mac.\nDeny: I can't right now.", type: "ask" },
    title: `Plug in the Mac: its battery is at ${pct}%`,
  },
})

export const checkBattery = async (ctx: {
  now: Date
  ops: string
  repo: string
  run: Run
}): Promise<string | undefined> => {
  const pmset = await ctx.run(["pmset", "-g", "batt"], 20_000)
  if (pmset.code !== 0) return undefined
  const { discharging, pct } = batteryOf(pmset.out)
  const path = join(ctx.ops, "awake", "battery-state.json")
  const state: BatteryState = await readFile(path, "utf8")
    .then((text) => JSON.parse(text) as BatteryState)
    .catch(() => ({}))
  const ask = (args: string[], stdin?: string) =>
    ctx.run(["bun", "run", "--cwd", ctx.repo, "ask", ...args], 120_000, stdin)
  const failures: string[] = []
  if (discharging && pct !== null) {
    const roster = await readFile(join(ctx.ops, "..", "roster.json"), "utf8")
      .then((text) => JSON.parse(text) as { agents?: unknown })
      .catch(() => null)
    const items = itemsOf(pct, managerOf(roster?.agents, "ops"))
    for (const [key, at] of [
      ["ask", ORANGE],
      ["alert", RED],
    ] as const) {
      if (pct > at || state[key]) continue
      const posted = await ask(["new"], JSON.stringify(items[key]))
      const id = posted.out
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^[0-9a-f-]{36}$/.test(line))
      if (posted.code === 0 && id) state[key] = id
      else failures.push(`${key} not posted to the Inbox: ${posted.out.trim().slice(-200)}`)
    }
  } else if (!discharging) {
    for (const key of ["ask", "alert"] as const) {
      const id = state[key]
      if (!id) continue
      const got = await ask(["get", id])
      let item: { answer?: { ackedAt?: unknown }; status?: string } = {}
      try {
        item = JSON.parse(got.out.slice(got.out.indexOf("{")))
      } catch {}
      const closing = item.answer?.ackedAt
        ? null
        : item.status === "open"
          ? ["settle", id, "--note", BACK]
          : item.status === "approved"
            ? ["ack", id, "--no-link", BACK]
            : item.status
              ? ["get", id, "--ack"]
              : undefined
      const closed = closing === null ? { code: 0, out: "" } : closing && (await ask(closing))
      if (closed && closed.code === 0) delete state[key]
      else
        failures.push(
          `battery item ${id} not closed: ${(closed?.out ?? got.out).trim().slice(-200)}`,
        )
    }
  }
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
