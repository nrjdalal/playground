import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { REPO } from "../ops-job/job"
import { orgsIo, whichSkill } from "../playground/orgs"
import { underVault } from "./slack"

// dm send <file>: the one way a session posts to the owner's DM, Alpha and Bravo alike; dm upload: the dashboard's share of a Slack send's files, its spec (upload.ts's Spec) on stdin. The token reaches only send.ts's or upload.ts's own process, through vault.
const [verb, file] = process.argv.slice(2)
const sending = verb === "send" && file && isAbsolute(file) && (await Bun.file(file).exists())
if (!sending && !(verb === "upload" && !file)) {
  console.error(
    "usage: playground dm send <file>, the reply's body in a file named by its absolute path; or playground dm upload, its spec on stdin",
  )
  process.exit(2)
}
const vault = await whichSkill(orgsIo(REPO, dataDir()), "vault")
if (!vault.dir) {
  console.error(`dm ${verb}: ${vault.refusal}`)
  process.exit(2)
}
const script = join(import.meta.dir, sending ? "send.ts" : "upload.ts")
const proc = Bun.spawn(underVault(vault.dir, script, sending ? [file] : []), {
  stdio: [sending ? "ignore" : "inherit", "inherit", "inherit"],
})
process.exit(await proc.exited)
