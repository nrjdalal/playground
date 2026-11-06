import { join } from "node:path"

import { firefightingSettings, readPolicy } from "@packages/settings"

import { engineData, REPO, run, scheduled } from "../ops-job/job"
import type { Beat, Context } from "../ops-tick/tick"
import { vaultRefusal } from "../playground/installed"
import { orgsIo, whichSkill } from "../playground/orgs"
import { loadSessionNames } from "../playground/setting"
import { type StartConfig, startPass } from "./start"

const data = engineData("ops-firefighting-start")

// firefighting.start's settings, read each beat, so a change takes on the next minute.
const config = async (): Promise<StartConfig> => {
  const policy = await readPolicy(data)
  if (policy.refusal !== undefined) throw new Error(policy.refusal)
  const get = <K extends Parameters<typeof firefightingSettings.get>[1]>(key: K) =>
    firefightingSettings.get(policy.settings, key)
  return {
    account: get("firefighting.start.account") || undefined,
    brief: get("firefighting.start.brief"),
    freshMinutes: get("firefighting.start.freshMinutes"),
    in: get("firefighting.start.in") || undefined,
    prefixes: get("firefighting.start.prefixes"),
  }
}

// A new worker's name, as bun run name gives one.
const name = async (): Promise<string> => {
  const r = await run([process.execPath, join(import.meta.dir, "..", "name", "index.ts"), "worker"])
  const picked = r.out.trim().split("\n").at(-1) ?? ""
  if (r.code !== 0 || !/^[a-z0-9]+-worker$/.test(picked))
    throw new Error(`bun run name worker: ${r.out.trim()}`)
  return picked
}

// Each ticket's Linear state type through linear-read, whose key reaches only its own process through vault, the secrets skill an org's extension holds.
const linearStates =
  (ctx: Context) =>
  async (ids: string[]): Promise<Record<string, string>> => {
    const vault = await whichSkill(orgsIo(REPO, data), "vault")
    if (vault.refusal !== undefined) throw new Error(vaultRefusal(vault.refusal))
    const { code, out } = await ctx.run([
      Bun.which("uv") ?? "uv",
      "run",
      "--python",
      "3.13",
      join(vault.dir, "scripts", "vault.py"),
      "run",
      "-e",
      "LINEAR_API_KEY=shared.linear.api-key",
      "--",
      process.execPath,
      join(import.meta.dir, "..", "linear-read", "cli.ts"),
      "states",
      ids.join(","),
    ])
    if (code !== 0) throw new Error(out.trim().split("\n").at(-1) || `linear-read exited ${code}`)
    return JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>
  }

export const BEATS: Beat[] = [
  {
    cron: "* * * * *",
    name: "firefighting-start",
    run: async (ctx) =>
      startPass({ config: await config(), ctx, data, linearStates: linearStates(ctx), name }),
    to: "builder",
  },
]

if (import.meta.main) {
  loadSessionNames()
  scheduled("ops-firefighting-start", BEATS, join(data, "ops"))
}
