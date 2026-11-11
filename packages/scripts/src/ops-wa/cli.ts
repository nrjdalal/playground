import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { managerOf } from "@packages/config/kinds"
import { configDirOf } from "@packages/env/data-dir"
import { extSettings, readPolicy, whatsappSettings } from "@packages/settings"
import makeWASocket, { Browsers, type SocketConfig, useMultiFileAuthState } from "baileys"

import { assistantOf, busyOf, stuckOf } from "../ops-job/dispatcher"
import { engineData, REPO, run, sendAs } from "../ops-job/job"
import { beat, CYCLE_SECONDS } from "../ops-tick/tick"
import { dashboardCheckout } from "../playground/probe"
import { bridge, type Sock, sender } from "./bridge"
import { keepAlive, ownFolder, releaseLock, SOCKET, takeLock } from "./habits"
import { life, type LinkSock, PAIRING, unguarded } from "./life"
import { socketPath, serve } from "./server"

// ops-wa: the WhatsApp link on the spare number, held by ops-wa's life; it beats ok while it runs and, once stopped, beats why, idle, so up.py does not start it again and its row reads the reason.
process.umask(0o077)
const data = engineData("ops-wa")
const dir = join(data, "whatsapp")
const ops = join(data, "ops")
const startedAt = new Date()
let result = "ok"
const pulse = () =>
  beat(join(ops, "ops-wa.json"), startedAt, new Date(), result, "ops-wa").catch((e) =>
    console.error(e),
  )
void pulse()
setInterval(() => void pulse(), CYCLE_SECONDS * 1000)
const stop = (why: string, word = "stopped") => {
  result = `${word}: ${why}`
  console.error(`ops-wa: ${result}`)
  void pulse()
}

// One Inbox update under the ops manager's name, as ops-tick posts its alerts, answering its id; bun run ask runs in the Dashboard's checkout, whose .env names the Inbox's database.
const inbox = dashboardCheckout(REPO) ?? REPO
const ask = async (verb: string[], stdin?: string) =>
  run(["bun", "run", "--silent", "--cwd", inbox, "ask", ...verb], 120_000, stdin)
const by = async () =>
  managerOf(
    (
      (await Bun.file(join(data, "roster.json"))
        .json()
        .catch(() => null)) as { agents?: unknown } | null
    )?.agents,
    "ops",
  )
const post = async (title: string, text: string, outcome?: "alert") => {
  const posted = await ask(
    ["new"],
    JSON.stringify({ from: await by(), kind: "update", preview: { outcome, text }, title }),
  )
  return posted.out
    .split("\n")
    .find((l) => /^[0-9a-f-]{36}$/.test(l.trim()))
    ?.trim()
}

const main = async () => {
  const policy = await readPolicy(data)
  if (policy.refusal !== undefined) return stop(`the settings refuse: ${policy.refusal}`)
  const owner = whatsappSettings.get(policy.settings, "wa.owner")
  const device = whatsappSettings.get(policy.settings, "wa.device")
  if (!owner || !device) return stop("wa.owner and wa.device must both be set", "waiting")
  await ownFolder(dir)
  const lock = join(dir, "lock")
  // a holder is a live ops-wa, so a pid the OS gave to another program frees the lock
  const holder = await takeLock(lock, process.pid, (pid) => {
    try {
      process.kill(pid, 0)
    } catch {
      return false
    }
    return Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)])
      .stdout.toString()
      .includes("ops-wa")
  })
  if (holder) return stop(holder)
  process.on("exit", () => releaseLock(lock, process.pid))
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const)
    process.on(signal, () => process.exit(0))
  const creds = await Bun.file(join(dir, "auth", "creds.json"))
    .json()
    .catch(() => ({}))
  if (!(creds as { registered?: boolean }).registered) {
    const refusal = await unguarded(join(REPO, "scripts", "factory-settings.json"))
    if (refusal) return stop(refusal)
  }
  const { saveCreds, state } = await useMultiFileAuthState(join(dir, "auth"))
  let current: Sock | undefined
  const send = sender({
    dir,
    now: Date.now,
    owner,
    sleep: Bun.sleep,
    sock: {
      ev: { on: () => {} },
      sendMessage: (jid, content) => {
        if (!current)
          throw new Error("ops-wa is not connected to WhatsApp now; try again in a minute")
        return current.sendMessage(jid, content)
      },
    },
  })
  const path = socketPath(data)
  await unlink(path).catch(() => {})
  serve(path, send)
  const relay = sendAs("wa", true, true)
  const seconds = () => Date.now() / 1000
  const config = configDirOf(process.env)
  const watched = bridge({
    assistant: () => assistantOf(data),
    busy: () => busyOf("dispatcher", data, config, seconds()),
    dir,
    log: (line) => console.log(line),
    now: Date.now,
    // WhatsApp mode is the bundled whatsapp extension's switch, read afresh for each message
    on: async () => {
      const read = await readPolicy(data)
      return (
        read.refusal === undefined &&
        extSettings.get(read.settings, "ext.bundled").includes("whatsapp")
      )
    },
    owner,
    relay: (to, text) => relay(to, text),
    reply: send,
    sleep: Bun.sleep,
    stuck: () => stuckOf("dispatcher", data, config, seconds()),
  })
  const passes = setInterval(() => watched.pass(), 30_000)
  const reminder = setInterval(
    () =>
      void keepAlive(dir, Date.now(), () =>
        post(
          "Open WhatsApp on the spare phone",
          "A linked device drops after 14 days with its phone away: open WhatsApp on the spare phone once, with its SIM in, to keep the link.",
        ),
      ),
    3_600_000,
  )
  // Baileys logs messages it handles, so its logger stays silent and the owner's words stay out of every log
  const silent: SocketConfig["logger"] = {
    child: () => silent,
    debug() {},
    error() {},
    info() {},
    level: "silent",
    trace() {},
    warn() {},
  }
  const why = await life({
    alert: (text) => post("ops-wa needs a look", text, "alert"),
    card: (code) => {
      result = "waiting: the pairing code waits to be typed on the spare phone"
      void pulse()
      return post(`Link WhatsApp: code ${code.slice(0, 4)}-${code.slice(4)}`, PAIRING)
    },
    connect: async () => {
      const sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS("Chrome"),
        logger: silent,
        ...SOCKET,
      })
      sock.ev.on("creds.update", saveCreds)
      return sock as unknown as LinkSock & Sock
    },
    device,
    dir,
    linked: async (id) => {
      result = "ok"
      void pulse()
      return ask(["resolve", id, "--by", await by(), "--note", "linked"])
    },
    listen: (sock) => {
      current = sock
      watched.attach(sock)
    },
    now: Date.now,
    owner,
    sleep: Bun.sleep,
  })
  current = undefined
  clearInterval(reminder)
  clearInterval(passes)
  stop(why)
}

await main().catch((error: Error) => stop(error.message))
