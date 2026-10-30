import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { apiUp, dashboardCheckout, dashboardUrls } from "../playground/probe"
import { writeAtomic } from "../write-atomic"
import type { Context } from "./tick"

// A live dashboard roll measured 15s down and a failed restart cycle about 2.5 minutes, so 5 minutes in a row is an outage no restart is fixing.
export const DASHBOARD_DOWN_MINUTES = 5

type DashboardWatch = { downSince: string; lastDownAt?: string; told?: boolean }

// The live dashboard's API answering 200 on /api/health, as `playground` reads it.
const dashboardUp = async (ctx: Context): Promise<boolean> => {
  const dashboard = dashboardCheckout(ctx.repo)
  return !!dashboard && apiUp(dashboardUrls(dashboard))
}

// Through the ops relay to ops, and as a macOS banner, since the Inbox shows only on the Dashboard that is down.
const banner = async (ctx: Context, text: string) => {
  const notify = join(ctx.repo, "scripts", "ops", "notify.sh")
  const sent = await ctx.run(["env", "NOTIFY_MAC=1", "bash", notify, "tick", text], 30_000)
  if (sent.code !== 0) throw new Error(`notify.sh: ${sent.out.trim().slice(0, 200)}`)
}

const minutesSince = (ctx: Context, since: string): number =>
  Math.floor((ctx.now.getTime() - Date.parse(since)) / 60_000)

// Each minute: the run of failures is kept in tick/dashboard-watch.json, one banner goes out once the dashboard has failed DASHBOARD_DOWN_MINUTES in a row, and one more when it answers again; an answer, or a gap of over 2 minutes with no check, ends the run quietly before then.
export const dashboardWatch = async (ctx: Context, up = dashboardUp) => {
  const statePath = join(ctx.ops, "tick", "dashboard-watch.json")
  const state = (await Bun.file(statePath)
    .json()
    .catch(() => null)) as DashboardWatch | null
  if (await up(ctx)) {
    if (!state) return
    if (state.told)
      await banner(
        ctx,
        `The Dashboard answers again, after ${minutesSince(ctx, state.downSince)} minutes down`,
      )
    await unlink(statePath)
    return
  }
  const now = ctx.now.toISOString()
  const run: DashboardWatch =
    !state ||
    Number.isNaN(Date.parse(state.downSince)) ||
    (!state.told && minutesSince(ctx, state.lastDownAt ?? state.downSince) > 2)
      ? { downSince: now }
      : state
  const down = minutesSince(ctx, run.downSince)
  if (!run.told && down >= DASHBOARD_DOWN_MINUTES) {
    await banner(ctx, `The Dashboard has not answered for ${down} minutes`)
    run.told = true
  }
  await writeAtomic(statePath, JSON.stringify({ ...run, lastDownAt: now }))
}
