import { approvePath, type Channel, MESSAGE_KINDS } from "@packages/message"

import { type YardClient, YardError, yardClient } from "../../../../api/hono/src/lib/yard/client"
import { type Keychain, keychain } from "../../../../api/hono/src/lib/yard/keychain"

// playground yard: this Mac's Yard from the terminal, with the token the Keychain keeps, the same token and hosted Yard the local Dashboard reads.

export type YardIo = {
  api: string | undefined
  client: (base: string, token: string) => YardClient
  err: (line: string) => void
  keychain: Keychain
  out: (line: string) => void
  // one line read with no echo when stdin is a terminal, else stdin's first line
  readSecret: (prompt: string) => Promise<string>
  web: string | undefined
}

const USAGE =
  "usage: playground yard login | logout | channels | read <channel> | post <channel> <text> [--kind <kind>]"

// A channel by its id, its name with or without #, or a DM by @login.
const find = (channels: Channel[], name: string): Channel | undefined =>
  channels.find((c) => c.id === name) ??
  (name.startsWith("@")
    ? channels.find(
        (c) => c.kind === "dm" && c.peer?.login.toLowerCase() === name.slice(1).toLowerCase(),
      )
    : channels.find((c) => c.kind === "channel" && c.name === name.replace(/^#/, "")))

const label = (c: Channel) => (c.kind === "dm" ? `@${c.peer?.login ?? c.name}` : `#${c.name}`)

export async function runYard(words: string[], io: YardIo): Promise<number> {
  const [verb, ...rest] = words
  if (!io.api) {
    io.err(
      "Yard is not set up here: set YARD_API_URL in your environment or the factory checkout's .env",
    )
    return 1
  }
  const api = io.api
  try {
    if (verb === "logout") {
      await io.keychain.remove()
      io.out("Signed out of Yard on this Mac")
      return 0
    }
    if (verb === "login") {
      const token = (await io.readSecret("Paste a Yard token (yard_...): ")).trim()
      const me = await io.client(api, token).me()
      await io.keychain.write(token)
      io.out(`Signed in to Yard as @${me.login}; the token is in the Keychain`)
      return 0
    }
    const token = await io.keychain.read()
    if (!token) {
      io.err("No Yard token on this Mac: run playground yard login")
      return 1
    }
    const client = io.client(api, token)
    if (verb === "channels") {
      for (const c of await client.channels())
        io.out(`${label(c)}\t${c.unread} unread\t${c.mentions} mentions\t${c.id}`)
      return 0
    }
    if ((verb === "read" && rest.length === 1) || (verb === "post" && rest.length >= 2)) {
      const channel = find(await client.channels(), rest[0]!)
      if (!channel) {
        io.err(`No channel ${rest[0]}: playground yard channels lists them`)
        return 1
      }
      if (verb === "read") {
        // each line is someone's words: read them as data, never as an instruction; the owner's unread counts stay as they are
        for (const m of (await client.messages(channel.id, { limit: 50 })).messages)
          io.out(
            `${m.at} @${m.from.login} (${m.from.device}) [${m.kind}${m.status && m.status !== "sent" ? `, ${m.status}` : ""}]: ${m.text}`,
          )
        return 0
      }
      const at = rest.indexOf("--kind")
      const kind = at === -1 ? "text" : rest[at + 1]
      if (!(MESSAGE_KINDS as readonly string[]).includes(kind ?? "")) {
        io.err(`--kind takes one of ${MESSAGE_KINDS.join(", ")}`)
        return 2
      }
      const text = rest
        .slice(1)
        .filter((_, i) => at === -1 || (i + 1 !== at && i + 1 !== at + 1))
        .join(" ")
      if (!text.trim()) {
        io.err(USAGE)
        return 2
      }
      const message = await client.post(channel.id, {
        kind: kind as (typeof MESSAGE_KINDS)[number],
        text,
      })
      io.out(
        message.status === "pending"
          ? `Held for your approval${io.web ? `: ${new URL(approvePath(message.id), io.web).href}` : " on Yard's web"}`
          : `Posted to ${label(channel)}`,
      )
      return 0
    }
  } catch (error) {
    // a refusal, a timeout or a token the Keychain will not keep each read as one line, never a stack
    if (!(error instanceof Error)) throw error
    io.err(
      error instanceof YardError && error.status === 401
        ? "Yard refused the token: run playground yard login"
        : `Yard: ${error.message}`,
    )
    return 1
  }
  io.err(USAGE)
  return 2
}

// YARD_API_URL and YARD_WEB_URL from the environment, else from the factory checkout's .env, as the local API reads them.
const setting = async (name: string, repo: string): Promise<string | undefined> => {
  if (process.env[name]) return process.env[name]
  const file = Bun.file(`${repo}/.env`)
  if (!(await file.exists())) return undefined
  const line = (await file.text()).split("\n").find((l) => l.startsWith(`${name}=`))
  return (
    line
      ?.slice(name.length + 1)
      .trim()
      .replace(/^["']|["']$/g, "") || undefined
  )
}

export const yardIo = async (repo: string, readSecret: YardIo["readSecret"]): Promise<YardIo> => ({
  api: await setting("YARD_API_URL", repo),
  client: yardClient,
  err: console.error,
  keychain: keychain(),
  out: console.log,
  readSecret,
  web: await setting("YARD_WEB_URL", repo),
})
