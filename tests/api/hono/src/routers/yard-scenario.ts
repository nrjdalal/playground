// Run by yard.test.ts as `bun -e` in api/hono, so the hosted build's env loads fresh: serves the hosted app on Bun.serve and prints one JSON line of what each request answered.
const { default: shape } = await import(process.env.YARD_HOSTED!)
const server = Bun.serve(shape)
const api = `http://127.0.0.1:${server.port}/api/v1/yard`
const web = process.env.HONO_WEB_URL!
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` })
const json = { "content-type": "application/json" }
const status = async (path: string, init: RequestInit = {}) =>
  (await fetch(`${api}${path}`, init)).status
const upgrade = {
  connection: "Upgrade",
  "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  "sec-websocket-version": "13",
  upgrade: "websocket",
}

const out: Record<string, unknown> = {}
out.noAuth = await status("/channels")
out.ottVerify = (
  await fetch(`http://127.0.0.1:${server.port}/api/auth/one-time-token/verify`, {
    body: JSON.stringify({ token: "any" }),
    headers: { ...json, origin: web },
    method: "POST",
  })
).status
out.tokenList = await (
  await fetch(`${api}/channels`, { headers: bearer(process.env.BO_TOKEN!) })
).json()
out.tokenOnWebOnly = await status("/tokens", { headers: bearer(process.env.BO_TOKEN!) })
out.cookieWriteNoOrigin = await status("/channels", { body: "{}", headers: json, method: "POST" })
const made = await fetch(`${api}/channels`, {
  body: JSON.stringify({ name: "ops" }),
  headers: { ...json, ...bearer(process.env.BO_TOKEN!) },
  method: "POST",
})
const channel = (await made.json()).data.channel
out.created = made.status
await fetch(`${api}/channels/${channel.id}/join`, {
  headers: bearer(process.env.DI_TOKEN!),
  method: "POST",
})
out.socketNoOrigin = await status(`/socket?token=${process.env.DI_OTT}`, { headers: upgrade })
out.socketNoToken = await status("/socket", { headers: { ...upgrade, origin: web } })

const socket = new WebSocket(
  `ws://127.0.0.1:${server.port}/api/v1/yard/socket?token=${process.env.DI_OTT}`,
  {
    headers: { origin: web },
  } as never,
)
const frames: unknown[] = []
socket.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
out.socket = await new Promise((done) => {
  socket.onopen = () => done("open")
  socket.onerror = () => done("error")
})
const posted = await fetch(`${api}/channels/${channel.id}/messages`, {
  body: JSON.stringify({ kind: "question", text: "anyone up?" }),
  headers: { ...json, ...bearer(process.env.BO_TOKEN!) },
  method: "POST",
})
out.posted = [posted.status, (await posted.json()).data.message.status]
await Bun.sleep(1100)
const held = await fetch(`${api}/channels/${channel.id}/messages`, {
  body: JSON.stringify({ kind: "steps", text: "run it" }),
  headers: { ...json, ...bearer(process.env.BO_TOKEN!) },
  method: "POST",
})
out.held = (await held.json()).data.message.status
await Bun.sleep(200)
out.frames = frames
console.log(JSON.stringify(out))
process.exit(0)

export {}
