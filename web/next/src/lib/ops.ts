"use client"

import type { OpsRow, OpsStatus } from "@api/hono"
import { scheduleWords } from "@packages/config/schedule"
import { useQuery } from "@tanstack/react-query"

import { apiClient, unwrap } from "@/lib/api/client"
import { relativeTime } from "@/lib/time"

export const OPS_QUERY_KEY = ["dashboard", "ops"] as const

// The fastest job beats every 15s, so reading as often shows each beat.
export const OPS_REFRESH_MS = 15_000

export async function fetchOps(): Promise<OpsRow[]> {
  const { data, error } = await unwrap(apiClient.v1.ops.$get())
  if (error) throw new Error(error.message)
  return data
}

// The ops jobs' rows for the sidebar's Scripts group, on the owner rung alone.
export const useOps = (enabled: boolean) =>
  useQuery({
    enabled,
    queryKey: OPS_QUERY_KEY,
    queryFn: fetchOps,
    refetchInterval: OPS_REFRESH_MS,
    staleTime: 5000,
  })

// Each status in words, capitalised as the sidebar's other states are.
export const OPS_LABELS: Record<OpsStatus, string> = {
  down: "Down",
  failing: "Failing",
  running: "Running",
}

// Pure: an ops row's second line in parts: its status, the reason when it has one, and when it last beat, which the sidebar draws apart so the reason alone gives way to the row's width.
export const opsParts = (row: OpsRow, now: number) => ({
  beat: row.lastBeatAt ? `beat ${relativeTime(row.lastBeatAt, new Date(now))}` : null,
  reason: row.reason,
  status: OPS_LABELS[row.status],
})

// Pure: an ops row's second line whole, for its hover (Running · beat just now, Failing: check failing · beat 1 min. ago, Down: No heartbeat file).
export const opsLine = (row: OpsRow, now: number): string => {
  const { beat, reason, status } = opsParts(row, now)
  return [reason ? `${status}: ${reason}` : status, beat].filter(Boolean).join(" · ")
}

// Pure: the jobs the Scripts group lists: every one jobs.json does not pause, so a paused job is not shown as down, while one that should run and is down stays, in red.
export const shownOps = (rows: OpsRow[]): OpsRow[] => rows.filter((row) => row.paused !== true)

// Pure: the jobs the System page lists, muted, as Paused: the ones jobs.json pauses on purpose, which the Scripts group leaves out.
export const pausedOps = (rows: OpsRow[]): OpsRow[] => rows.filter((row) => row.paused === true)

// Pure: when a job runs, in words, lowercased to sit inside a line (every 5 min, every day at 5:00 AM); null with no schedule.
export const whenWords = (schedule: OpsRow["schedule"]): string | null => {
  if (!schedule) return null
  const words = scheduleWords(schedule)
  return words.charAt(0).toLowerCase() + words.slice(1)
}

// Pure: the Scripts label's count: the jobs it lists, so the paused ones, which it leaves out, are not counted.
export const scriptCount = (rows: OpsRow[]): number => shownOps(rows).length

// Pure: the Scripts group on the collapsed rail, one icon: red while any script it lists is failing or down, its words the label's count and how many are not running.
export const scriptsRail = (rows: OpsRow[]): { broken: boolean; words: string } => {
  const count = scriptCount(rows)
  const down = shownOps(rows).filter((row) => row.status !== "running").length
  return {
    broken: down > 0,
    words: [`Scripts ${count}`, down > 0 && `${down} not running`].filter(Boolean).join(" · "),
  }
}

// Pure: the scripts the group shows: every job it lists while open; collapsed, only those failing or down, so nothing broken hides.
export const scriptsShown = (rows: OpsRow[], open: boolean): OpsRow[] =>
  shownOps(rows).filter((row) => open || row.status !== "running")
