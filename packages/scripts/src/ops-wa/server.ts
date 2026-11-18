import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"

import type { Kind, Who } from "./bridge"

// The one way into ops-wa: a unix socket in its own folder, mode 600, one JSON line each way ({body, alert?, source?, to?} in, `alert: true` an urgent alert to both numbers at once, `alert: "first"` one to the owner first with its source, `to: "alert"` a guest's reply, or {alertSet} in, an owner's message id, or {react, id?, to?} in, a reaction, or {settingSet: {id, key, value}} in, {sent, note?} or {refusal} out, the note saying who an alert missed); it listens on no port.
export const socketPath = (data: string) => join(data, "whatsapp", "wa.sock")

type Reply = { note?: string; refusal?: string; sent?: true }

type React = (emoji: string, on: { id?: string; who?: Who }) => Promise<string>

export function serve(
  path: string,
  send: (body: string, kind: Kind, source?: string) => Promise<string>,
  alertSet?: (id: string) => Promise<string>,
  settingSet?: (id: string, key: string, value: string) => Promise<string>,
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
          alertSet?: unknown
          body?: unknown
          id?: unknown
          react?: unknown
          settingSet?: { id?: unknown; key?: unknown; value?: unknown }
          source?: unknown
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
        const set = asked.settingSet
        if (
          settingSet &&
          typeof set?.id === "string" &&
          set.id &&
          typeof set.key === "string" &&
          set.key &&
          typeof set.value === "string"
        )
          return void settingSet(set.id, set.key, set.value).then(
            (said) => answer({ note: said }),
            (error: Error) => answer({ refusal: error.message }),
          )
        if (react && typeof asked.react === "string" && asked.react)
          return void react(asked.react, {
            id: typeof asked.id === "string" ? asked.id : undefined,
            who: asked.to === "alert" ? "alert" : "owner",
          }).then(
            () => answer({ sent: true }),
            (error: Error) => answer({ refusal: error.message }),
          )
        const { body } = asked
        if (typeof body !== "string" || !body.trim()) return answer({ refusal: "an empty body" })
        const kind =
          asked.alert === true
            ? "alert"
            : asked.alert === "first"
              ? "first"
              : asked.to === "alert"
                ? "guest"
                : "reply"
        const source = typeof asked.source === "string" && asked.source ? asked.source : undefined
        send(body, kind, kind === "first" ? source : undefined).then(
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
  kind: Exclude<Kind, "escalate"> = "reply",
  timeoutMs = 600_000,
  source?: string,
) =>
  ask(
    path,
    kind === "alert"
      ? { alert: true, body }
      : kind === "first"
        ? { alert: "first", body, ...(source && { source }) }
        : kind === "guest"
          ? { body, to: "alert" }
          : { body },
    timeoutMs,
  )

// wa react's side: a reaction on the latest message of who's, or on the one its id names.
export const reactRequest = (path: string, emoji: string, on: { id?: string; who?: Who }) =>
  ask(
    path,
    { react: emoji, ...(on.id && { id: on.id }), ...(on.who === "alert" && { to: "alert" }) },
    600_000,
  )

// wa alert-set's side: the owner's message id to ops-wa, and its answer.
export const requestAlertSet = (path: string, id: string) => ask(path, { alertSet: id }, 60_000)

// settings set --from-owner-msg's side: the owner's message id, the key and the value as typed, to ops-wa, and its answer.
export const requestSettingSet = (path: string, id: string, key: string, value: string) =>
  ask(path, { settingSet: { id, key, value } }, 60_000)

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
