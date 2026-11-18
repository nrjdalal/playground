import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"

import type { Kind, Who } from "./bridge"

// The one way into ops-wa: a unix socket in its own folder, mode 600, one JSON line each way ({body, alert?, to?} in, `to: "alert"` a guest's reply, or {react, id?, to?} for a reaction, {sent, note?} or {refusal} out, the note saying who an alert missed); it listens on no port.
export const socketPath = (data: string) => join(data, "whatsapp", "wa.sock")

type Reply = { note?: string; refusal?: string; sent?: true }

type React = (emoji: string, on: { id?: string; who?: Who }) => Promise<string>

export function serve(
  path: string,
  send: (body: string, kind: Kind) => Promise<string>,
  react?: React,
) {
  const server = Bun.listen<{ done: boolean; text: string }>({
    socket: {
      data: (socket, chunk) => {
        // one request per connection: bytes after its line never send again
        if (socket.data.done) return
        socket.data.text += chunk.toString()
        if (!socket.data.text.includes("\n")) return
        socket.data.done = true
        const answer = (reply: Reply) => {
          socket.write(`${JSON.stringify(reply)}\n`)
          socket.end()
        }
        let asked: {
          alert?: unknown
          body?: unknown
          id?: unknown
          react?: unknown
          to?: unknown
        } = {}
        try {
          asked = JSON.parse(socket.data.text) as typeof asked
        } catch {}
        const { body } = asked
        const id = typeof asked.id === "string" ? asked.id : undefined
        const reacting = typeof asked.react === "string" && react
        if (!reacting && (typeof body !== "string" || !body.trim()))
          return answer({ refusal: "an empty body" })
        const kind = asked.alert === true ? "alert" : asked.to === "alert" ? "guest" : "reply"
        ;(reacting
          ? react(asked.react as string, { id, who: asked.to === "alert" ? "alert" : "owner" })
          : send(body as string, kind)
        ).then(
          (said) => answer(said === "sent" ? { sent: true } : { note: said, sent: true }),
          (error: Error) => answer({ refusal: error.message }),
        )
      },
      open: (socket) => {
        socket.data = { done: false, text: "" }
      },
    },
    unix: path,
  })
  chmodSync(path, 0o600)
  return server
}

// wa send's and wa alert's side: the body to ops-wa and its one-line answer, or why ops-wa did not answer.
export const request = (path: string, body: string, kind: Kind = "reply", timeoutMs = 600_000) =>
  ask(
    path,
    kind === "alert" ? { alert: true, body } : kind === "guest" ? { body, to: "alert" } : { body },
    timeoutMs,
  )

// wa react's side: a reaction on the latest message of who's, or on the one its id names.
export const reactRequest = (path: string, emoji: string, on: { id?: string; who?: Who }) =>
  ask(path, {
    react: emoji,
    ...(on.id && { id: on.id }),
    ...(on.who === "alert" && { to: "alert" }),
  })

async function ask(path: string, line: object, timeoutMs = 600_000): Promise<Reply> {
  if (!existsSync(path)) return { refusal: "ops-wa is not running: its job is off or stopped" }
  const answered = Promise.withResolvers<Reply>()
  const resolve = (reply: Reply) => {
    clearTimeout(timer)
    answered.resolve(reply)
  }
  let text = ""
  const timer = setTimeout(
    () => resolve({ refusal: "ops-wa did not answer in 10 minutes" }),
    timeoutMs,
  )
  await Bun.connect({
    socket: {
      close: () => {
        try {
          resolve(JSON.parse(text) as Reply)
        } catch {
          resolve({ refusal: "ops-wa closed the socket without an answer" })
        }
      },
      data: (_, chunk) => {
        text += chunk.toString()
      },
      error: () => resolve({ refusal: "ops-wa's socket did not answer" }),
      open: (socket) => {
        socket.write(`${JSON.stringify(line)}\n`)
      },
    },
    unix: path,
  }).catch(() => resolve({ refusal: "ops-wa is not running: its socket refuses the connect" }))
  return answered.promise
}
