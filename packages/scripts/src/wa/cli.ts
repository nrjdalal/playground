import { rename, rm } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { readPolicy, whatsappSettings } from "@packages/settings"

import { refusalOf, statusOf } from "../ops-wa/bridge"
import { request, socketPath } from "../ops-wa/server"

// wa send <file>: the one way a session writes to the owner on WhatsApp, through ops-wa's socket, to the owner's number alone, with --file <path> a file from the outbox beside it (outbound.ts), the body its caption; wa send --to alert <file>: a reply to the alert number, a guest of the chat; wa alert <file>: an urgent alert alone, once to the owner and once to the alert number; wa status: whether each number has written, and the owner's hours left for replies; wa relink: after a logout, sets the old link aside so ops-wa's next start posts a new pairing card.
const [verb, ...rest] = process.argv.slice(2)
let guest = false
let attach: string | undefined
const words: string[] = []
for (let i = 0; i < rest.length; i++) {
  if (verb === "send" && !guest && rest[i] === "--to" && rest[i + 1] === "alert") {
    guest = true
    i++
  } else if (verb === "send" && attach === undefined && rest[i] === "--file") {
    attach = rest[i + 1] ?? ""
    i++
  } else words.push(rest[i]!)
}
const [file, ...extra] = words
const named = async (path: string | undefined) =>
  !!path && isAbsolute(path) && (await Bun.file(path).exists())
if (verb === "relink" && !rest.length) {
  const dir = join(dataDir(), "whatsapp")
  // the old auth state is set aside inside the guarded folder, never deleted, so nothing leaves it
  await rename(join(dir, "auth"), join(dir, `auth.${Date.now()}.old`)).catch(() => {})
  await rm(join(dir, "logged-out"), { force: true })
  console.log("wa relink: the old link is set aside; restart ops-wa for a new pairing card")
  process.exit(0)
}
if (verb === "status" && !rest.length) {
  const policy = await readPolicy(dataDir())
  if (policy.refusal !== undefined) {
    console.error(`wa status: the settings refuse: ${policy.refusal}`)
    process.exit(1)
  }
  const lines = await statusOf(
    join(dataDir(), "whatsapp"),
    {
      alert: whatsappSettings.get(policy.settings, "wa.alert"),
      owner: whatsappSettings.get(policy.settings, "wa.owner"),
    },
    Date.now(),
  )
  for (const line of lines) console.log(`wa status: ${line}`)
  process.exit(0)
}
if (
  (verb !== "send" && verb !== "alert") ||
  extra.length ||
  !(file ? await named(file) : attach !== undefined) ||
  (attach !== undefined && !(await named(attach)))
) {
  console.error(
    "usage: playground wa send [--to alert] <file>, the reply's body in a file named by its absolute path, to the owner or to the alert number; playground wa send [--to alert] --file <path> [<file>], an image, a document, a video or a voice note in the data folder's wa/outbox/, named by its absolute path, the body its caption; playground wa alert <file>, an urgent alert alone, to the owner and the alert number; playground wa status; or playground wa relink",
  )
  process.exit(2)
}
const body = file ? (await Bun.file(file).text()).trimEnd() : ""
const refusal = refusalOf(body)
const reply: Awaited<ReturnType<typeof request>> = refusal
  ? { refusal }
  : await request(
      socketPath(dataDir()),
      body,
      verb === "alert" ? "alert" : guest ? "guest" : "reply",
      undefined,
      attach,
    )
if (reply.refusal) {
  console.error(`wa ${verb}: ${reply.refusal}`)
  process.exit(1)
}
console.log(`wa ${verb}: ${reply.note ?? "sent"}`)
