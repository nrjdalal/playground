import { rename, rm } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { readPolicy, whatsappSettings } from "@packages/settings"

import { refusalOf, statusOf } from "../ops-wa/bridge"
import { request, requestAlertSet, socketPath } from "../ops-wa/server"

// wa send <file>: the one way a session writes to the owner on WhatsApp, through ops-wa's socket, to the owner's number alone, with --file <path> a file from the outbox beside it (outbound.ts), the body its caption; wa send --to alert <file>: a reply to the alert number, a guest of the chat; wa alert <file>: an urgent alert alone, to the owner first and on to the alert number after wa.alertDelayMinutes unless handled, or to both at once with --now-both; wa status: whether each number has written or been approved, whether a reply can go to each now, and each pending alert; wa relink: after a logout, sets the old link aside so ops-wa's next start posts a new pairing card; wa alert-set --from-owner-msg <id>: the second number becomes the one number in the owner's own message of that id.
const args = process.argv.slice(2)
const guest = args[0] === "send" && args[1] === "--to" && args[2] === "alert"
// wa alert's flags, before its file: --now-both sends to both numbers at once, --source <kind>:<ref> names what a checker reads to tell whether it was handled
let nowBoth = false
let source: string | undefined
let rest = guest ? [args[0]!, ...args.slice(3)] : args
if (rest[0] === "alert")
  for (let i = 1; i < rest.length - 1;) {
    if (rest[i] === "--now-both") {
      nowBoth = true
      rest = [...rest.slice(0, i), ...rest.slice(i + 1)]
    } else if (rest[i] === "--source") {
      if (!/^[a-z][\w-]*:\S+$/.test(rest[i + 1] ?? "")) {
        console.error("wa alert: --source takes <kind>:<ref>, such as test:2026-11-11T03:00Z")
        process.exit(2)
      }
      source = rest[i + 1]
      rest = [...rest.slice(0, i), ...rest.slice(i + 2)]
    } else break
  }
// wa send's --file <path>, before its file: a file from the outbox, the body then its caption and optional
let attach: string | undefined
if (rest[0] === "send" && rest[1] === "--file") {
  attach = rest[2] ?? ""
  rest = [rest[0], ...rest.slice(3)]
}
const [verb, file, ...extra] = rest
const named = async (path: string | undefined) =>
  !!path && isAbsolute(path) && (await Bun.file(path).exists())
if (verb === "relink" && !file) {
  const dir = join(dataDir(), "whatsapp")
  // the old auth state is set aside inside the guarded folder, never deleted, so nothing leaves it
  await rename(join(dir, "auth"), join(dir, `auth.${Date.now()}.old`)).catch(() => {})
  await rm(join(dir, "logged-out"), { force: true })
  console.log("wa relink: the old link is set aside; restart ops-wa for a new pairing card")
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
if (verb === "alert-set") {
  if (file !== "--from-owner-msg" || extra.length !== 1 || !extra[0]) {
    console.error("usage: playground wa alert-set --from-owner-msg <id>")
    process.exit(2)
  }
  const reply = await requestAlertSet(socketPath(dataDir()), extra[0])
  if (reply.refusal) {
    console.error(`wa alert-set: ${reply.refusal}`)
    process.exit(1)
  }
  console.log(`wa alert-set: ${reply.note}`)
  process.exit(0)
}
if (
  (verb !== "send" && verb !== "alert") ||
  extra.length ||
  !(file ? await named(file) : attach !== undefined) ||
  (attach !== undefined && !(await named(attach)))
) {
  console.error(
    "usage: playground wa send [--to alert] <file>, the reply's body in a file named by its absolute path, to the owner or to the alert number; playground wa send [--to alert] --file <path> [<file>], an image, a document, a video or a voice note in the data folder's wa/outbox/, named by its absolute path, the body its caption; playground wa alert [--now-both] [--source <kind>:<ref>] <file>, an urgent alert alone, to the owner first and to the alert number unless handled before wa.alertDelayMinutes passes, or to both at once; playground wa status; playground wa alert-set --from-owner-msg <id>; or playground wa relink",
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
      verb === "alert" ? (nowBoth ? "alert" : "first") : guest ? "guest" : "reply",
      600_000,
      source,
      attach,
    )
if (reply.refusal) {
  console.error(`wa ${verb}: ${reply.refusal}`)
  process.exit(1)
}
console.log(`wa ${verb}: ${reply.note ?? "sent"}`)
