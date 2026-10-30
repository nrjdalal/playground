import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { REPO, scheduled } from "../ops-job/job"
import type { Beat } from "../ops-tick/tick"
import { orgsIo, whichSkill } from "../playground/orgs"

const told = new Set<string>()

// The token reaches only watch.ts's own process, through vault, so this job's command stays a plain bun.
export const BEATS: Beat[] = [
  {
    cron: "*/3,7,37 * * * *",
    name: "channel-watch",
    run: async (ctx) => {
      const mode = [7, 37].includes(ctx.now.getMinutes()) ? "full" : "quick"
      // vault, the secrets skill, comes from whichever scope holds it: an org's extension, not this checkout
      const vault = await whichSkill(orgsIo(REPO, dataDir()), "vault")
      const { code, out } = vault.dir
        ? await ctx.run([
            Bun.which("uv") ?? "uv",
            "run",
            "--python",
            "3.13",
            join(vault.dir, "scripts", "vault.py"),
            "run",
            "-e",
            "SLACK_TOKEN=local.slack.channel_token",
            "--",
            process.execPath,
            join(import.meta.dir, "watch.ts"),
            mode,
          ])
        : { code: 2, out: `error: ${vault.refusal}` }
      if (code === 0) {
        told.clear()
        return
      }
      const why =
        (/^error: (.+)$/m.exec(out)?.[1] ?? out.trim().split("\n").at(-1) ?? "").slice(0, 200) ||
        "no output"
      if (!told.has(why)) {
        told.add(why)
        await ctx.send("ops", `channel watch ${mode} failed (exit ${code}): ${why}`)
      }
      throw new Error(`exit ${code}: ${why}`)
    },
    to: "the dispatcher for each post or edit; ops once per kind of failure",
  },
]

if (import.meta.main) scheduled("ops-channel-watch", BEATS)
