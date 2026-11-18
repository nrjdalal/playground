import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"

import type { Kind } from "./bridge"

// The one way into ops-wa: a unix socket in its own folder, mode 600, one JSON line each way ({body, alert?, file?, to?} in, `to: "alert"` a guest's reply, `file` a path in the outbox (outbound.ts), the body then its caption and may be empty, or {alertSet} in, an owner's message id, {sent, note?} or {refusal} out, the note saying who an alert missed); it listens on no port.
export const socketPath = (data: string) => join(data, "whatsapp", "wa.sock")

type Reply = { note?: string; refusal?: string; sent?: true }

export function serve(
  path: string,
  send: (body: string, kind: Kind, file?: string) => Promise<string>,
  alertSet?: (id: string) => Promise<string>,
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
          alertSet?: unknown
          body?: unknown
          file?: unknown
          to?: unknown
        } = {}
        try {
          asked = JSON.parse(socket.data.text) as typeof asked
        } catch {}
        if (alertSet && typeof asked.alertSet === "string" && asked.alertSet)
          return void alertSet(asked.alertSet).then(
            (said) => answer({ note: said }),
            (error: Error) => answer({ refusal: error.message }),
          )
        const { body } = asked
        const file = typeof asked.file === "string" && asked.file ? asked.file : undefined
        if (typeof body !== "string" || (!body.trim() && !file))
          return answer({ refusal: "an empty body" })
        const kind = asked.alert === true ? "alert" : asked.to === "alert" ? "guest" : "reply"
        send(body, kind, file).then(
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
export const request = (
  path: string,
  body: string,
  kind: Kind = "reply",
  timeoutMs = 600_000,
  file?: string,
) =>
  ask(
    path,
    {
      ...(kind === "alert"
        ? { alert: true, body }
        : kind === "guest"
          ? { body, to: "alert" }
          : { body }),
      ...(file && { file }),
    },
    timeoutMs,
  )

// wa alert-set's side: the owner's message id to ops-wa, and its answer.
export const requestAlertSet = (path: string, id: string) => ask(path, { alertSet: id }, 60_000)

async function ask(path: string, line: object, timeoutMs: number): Promise<Reply> {
  if (!existsSync(path)) return { refusal: "ops-wa is not running: its job is off or stopped" }
  const answered = Promise.withResolvers<Reply>()
  const resolve = (reply: Reply) => {
    clearTimeout(timer)
    answered.resolve(reply)
  }
  let text = ""
  const timer = setTimeout(
    () => resolve({ refusal: `ops-wa did not answer in ${timeoutMs / 1000} s` }),
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
