import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { REPO } from "../ops-job/job"
import { orgsIo, whichSkill } from "../playground/orgs"
import { underVault } from "./slack"

// dm send <file>: the one way a session posts to the owner's DM, the dispatcher and the assistant alike; dm upload <item id>: the dashboard's share of an answered Inbox item's files, the place and the files read from that item alone. The token reaches only send.ts's or upload.ts's own process, through vault.
const [verb, file, ...extra] = process.argv.slice(2)
const sending =
  verb === "send" && !extra.length && file && isAbsolute(file) && (await Bun.file(file).exists())
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uploading = verb === "upload" && !extra.length && !!file && ITEM_ID.test(file)
if (!sending && !uploading) {
  console.error(
    "usage: playground dm send <file>, the reply's body in a file named by its absolute path; or playground dm upload <item id>, an answered Inbox item's id",
  )
  process.exit(2)
}
const vault = await whichSkill(orgsIo(REPO, dataDir()), "vault")
if (!vault.dir) {
  console.error(`dm ${verb}: ${vault.refusal}`)
  process.exit(2)
}
const script = join(import.meta.dir, sending ? "send.ts" : "upload.ts")
const proc = Bun.spawn(underVault(vault.dir, script, [file as string]), {
  stdio: ["ignore", "inherit", "inherit"],
})
process.exit(await proc.exited)
