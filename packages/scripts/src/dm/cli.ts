import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"

import { REPO } from "../ops-job/job"
import { orgsIo, whichSkill } from "../playground/orgs"
import { underVault } from "./slack"

// dm send <file>: the one way a session posts to the owner's DM, Alpha and Bravo alike; the token reaches only send.ts's own process, through vault.
const [verb, file] = process.argv.slice(2)
if (verb !== "send" || !file || !isAbsolute(file) || !(await Bun.file(file).exists())) {
  console.error(
    "usage: playground dm send <file>, the reply's body in a file named by its absolute path",
  )
  process.exit(2)
}
const vault = await whichSkill(orgsIo(REPO, dataDir()), "vault")
if (!vault.dir) {
  console.error(`dm send: ${vault.refusal}`)
  process.exit(2)
}
const proc = Bun.spawn(underVault(vault.dir, join(import.meta.dir, "send.ts"), [file]), {
  stdio: ["ignore", "inherit", "inherit"],
})
process.exit(await proc.exited)
