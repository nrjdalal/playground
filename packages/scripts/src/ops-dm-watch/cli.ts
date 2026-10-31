import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { readPolicy, slackSettings } from "@packages/settings"

import { underVault } from "../dm/slack"
import { REPO, scheduled } from "../ops-job/job"
import type { Beat } from "../ops-tick/tick"
import { orgsIo, whichSkill } from "../playground/orgs"

const told = new Set<string>()

// Slack mode on, and the DM and its owner set; each beat reads it afresh, so turning Slack mode off stops both at the next minute.
const slackMode = async (): Promise<boolean> => {
  const policy = await readPolicy(dataDir())
  if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
  const get = (key: "slack.dmChannel" | "slack.dmOwner" | "slack.mode") =>
    slackSettings.get(policy.settings, key)
  return (
    get("slack.mode") === true && Boolean(get("slack.dmChannel")) && Boolean(get("slack.dmOwner"))
  )
}

// The token reaches only watch.ts's own process, through vault, so this job's command stays a plain bun.
export const BEATS: Beat[] = [
  {
    cron: "* * * * *",
    name: "dm-watch",
    run: async (ctx) => {
      if (!(await slackMode())) return
      const vault = await whichSkill(orgsIo(REPO, dataDir()), "vault")
      const { code, out } = vault.dir
        ? await ctx.run(underVault(vault.dir, join(import.meta.dir, "watch.ts"), []))
        : { code: 2, out: `error: ${vault.refusal}` }
      if (code === 0) {
        told.clear()
        return
      }
      let why =
        (/^error: (.+)$/m.exec(out)?.[1] ?? out.trim().split("\n").at(-1) ?? "").slice(0, 200) ||
        "no output"
      // vault reads op's empty account list as a lock; an account list with nothing on it is the job's context, not a lock
      if (/is 1Password unlocked/.test(out)) {
        const accounts = await ctx.run(["op", "account", "list"], 30_000)
        if (accounts.code !== 0 || !accounts.out.trim())
          why =
            "op has no 1Password account in this job's context (op account list is empty), so vault cannot read the token"
      }
      if (!told.has(why)) {
        told.add(why)
        await ctx.send("ops", `DM watch failed (exit ${code}): ${why}`)
      }
      throw new Error(`exit ${code}: ${why}`)
    },
    to: "the dispatcher for each owner message, dispatcher-2 when none is answered; ops once per kind of failure",
  },
  {
    cron: "*/15 * * * *",
    name: "dm-update",
    run: async (ctx) => {
      if (!(await slackMode())) return
      await ctx.send(
        "dispatcher",
        "Slack mode: post the owner an update on the factory's work now, through playground dm send <file>.",
      )
    },
    to: "the dispatcher, every 15 minutes in Slack mode",
  },
]

if (import.meta.main) scheduled("ops-dm-watch", BEATS)
