import { rename, rm } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { readPolicy, whatsappSettings } from "@packages/settings"

import { refusalOf, statusOf } from "../ops-wa/bridge"
import { reactRequest, request, socketPath } from "../ops-wa/server"

// wa send <file>: the one way a session writes to the owner on WhatsApp, through ops-wa's socket, to the owner's number alone; wa send --to alert <file>: a reply to the alert number, a guest of the chat; wa alert <file>: an urgent alert alone, once to the owner and once to the alert number; wa react <emoji> [--to alert] [--id <id>]: a reaction on the latest message of the owner's, or the guest's, or on the one named; wa status: whether each number has written, and the owner's hours left for replies; wa relink: after a logout, sets the old link aside so ops-wa's next start posts a new pairing card.
const args = process.argv.slice(2)
const guest = args[0] === "send" && args[1] === "--to" && args[2] === "alert"
const [verb, file, ...extra] = guest ? [args[0], ...args.slice(3)] : args
if (verb === "relink" && !file) {
  const dir = join(dataDir(), "whatsapp")
  // the old auth state is set aside inside the guarded folder, never deleted, so nothing leaves it
  await rename(join(dir, "auth"), join(dir, `auth.${Date.now()}.old`)).catch(() => {})
  await rm(join(dir, "logged-out"), { force: true })
  console.log("wa relink: the old link is set aside; restart ops-wa for a new pairing card")
  process.exit(0)
}
if (args[0] === "react") {
  const [, emoji, ...flags] = args
  const on: { id?: string; who?: "alert" } = {}
  let bad = flags.length % 2 === 1
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] === "--to" && flags[i + 1] === "alert" && !on.who) on.who = "alert"
    else if (flags[i] === "--id" && flags[i + 1] && !on.id) on.id = flags[i + 1]
    else bad = true
  }
  // one emoji, as WhatsApp's reaction takes, never words
  const one =
    /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f\p{Emoji_Modifier}]*$/u
  if (bad || !emoji || !one.test(emoji)) {
    console.error("usage: playground wa react <emoji> [--to alert] [--id <id>]")
    process.exit(2)
  }
  const reply = await reactRequest(socketPath(dataDir()), emoji, on)
  if (reply.refusal) {
    console.error(`wa react: ${reply.refusal}`)
    process.exit(1)
  }
  console.log("wa react: sent")
  process.exit(0)
}
if (verb === "status" && !file) {
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
  !file ||
  !isAbsolute(file) ||
  !(await Bun.file(file).exists())
) {
  console.error(
    "usage: playground wa send [--to alert] <file>, the reply's body in a file named by its absolute path, to the owner or to the alert number; playground wa alert <file>, an urgent alert alone, to the owner and the alert number; playground wa react <emoji> [--to alert] [--id <id>]; playground wa status; or playground wa relink",
  )
  process.exit(2)
}
const body = (await Bun.file(file).text()).trimEnd()
const refusal = refusalOf(body)
const reply: Awaited<ReturnType<typeof request>> = refusal
  ? { refusal }
  : await request(
      socketPath(dataDir()),
      body,
      verb === "alert" ? "alert" : guest ? "guest" : "reply",
    )
if (reply.refusal) {
  console.error(`wa ${verb}: ${reply.refusal}`)
  process.exit(1)
}
console.log(`wa ${verb}: ${reply.note ?? "sent"}`)
