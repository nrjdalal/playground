import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"

// The one way into ops-wa: a unix socket in its own folder, mode 600, one JSON line each way ({body, alert?} in, {sent, note?} or {refusal} out, the note saying who an alert missed); it listens on no port.
export const socketPath = (data: string) => join(data, "whatsapp", "wa.sock")

type Reply = { note?: string; refusal?: string; sent?: true }

export function serve(path: string, send: (body: string, alert: boolean) => Promise<string>) {
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
        let asked: { alert?: unknown; body?: unknown } = {}
        try {
          asked = JSON.parse(socket.data.text) as typeof asked
        } catch {}
        const { body } = asked
        if (typeof body !== "string" || !body.trim()) return answer({ refusal: "an empty body" })
        send(body, asked.alert === true).then(
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
export async function request(
  path: string,
  body: string,
  alert = false,
  timeoutMs = 600_000,
): Promise<Reply> {
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
        socket.write(`${JSON.stringify(alert ? { alert, body } : { body })}\n`)
      },
    },
    unix: path,
  }).catch(() => resolve({ refusal: "ops-wa is not running: its socket refuses the connect" }))
  return answered.promise
}
