import { join } from "node:path"

import type { Context } from "../ops-tick/tick"

// ops-firefighting-start's pass, a stub until its fix commit: it starts nothing.

export type StartConfig = {
  account?: string
  brief: string
  freshMinutes: number
  in?: string
  prefixes: string[]
}

export const CAP = 2
export const REASON = "Urgent SLA"
export const START_FILE = "firefighting-start.json"

export type StartDeps = {
  config: StartConfig
  ctx: Context
  data: string
  linearStates: (ids: string[]) => Promise<Record<string, string>>
  name: () => Promise<string>
}

export const statePath = (ops: string) => join(ops, "ops-firefighting-start.state.json")

export async function startPass(_: StartDeps): Promise<void> {}
