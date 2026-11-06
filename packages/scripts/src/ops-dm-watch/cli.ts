import { dataDir } from "@packages/env/data-dir"
import { readPolicy, slackSettings } from "@packages/settings"

import { REPO, scheduled } from "../ops-job/job"
import type { Beat } from "../ops-tick/tick"
import { slackScript, slackSetUp } from "../playground/installed"
import { orgsIo } from "../playground/orgs"

const told = new Set<string>()

// Slack mode on, and the DM and its owner set; each beat reads it afresh, so turning Slack mode off stops both at the next minute.
const slackMode = async (): Promise<boolean> => {
  const policy = await readPolicy(dataDir())
  if (policy.refusal !== undefined) throw new Error(`the settings refuse: ${policy.refusal}`)
  return slackSettings.get(policy.settings, "slack.mode") === true && slackSetUp(policy.settings)
}

// The slack skill's watch.ts reads the token from the Keychain in its own process, so this job's command stays a plain bun.
export const BEATS: Beat[] = [
  {
    cron: "* * * * *",
    name: "dm-watch",
    run: async (ctx) => {
      if (!(await slackMode())) return
      const slack = await slackScript(orgsIo(REPO, dataDir()), "watch.ts")
      const { code, out } =
        slack.refusal === undefined
          ? await ctx.run([process.execPath, slack.script])
          : { code: 2, out: `error: ${slack.refusal}` }
      if (code === 0) {
        told.clear()
        return
      }
      const why =
        (/^error: (.+)$/m.exec(out)?.[1] ?? out.trim().split("\n").at(-1) ?? "").slice(0, 200) ||
        "no output"
      if (!told.has(why)) {
        told.add(why)
        await ctx.send("ops", `DM watch failed (exit ${code}): ${why}`)
      }
      throw new Error(`exit ${code}: ${why}`)
    },
    to: "the dispatcher for each owner message, the assistant seat's session when none is answered while the dispatcher is not mid-turn; ops once per kind of failure",
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
