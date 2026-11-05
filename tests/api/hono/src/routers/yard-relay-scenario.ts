// Run by yard.test.ts as `bun -e` in api/hono, so the hosted build's env loads fresh: serves the hosted app, holds a fake Mac on the relay's socket and prints one JSON line of what each request answered.
const { default: shape } = await import(process.env.YARD_HOSTED!)
const { sessionCookie } = await import("@/lib/sign-in")
const server = Bun.serve(shape)
const relay = `http://127.0.0.1:${server.port}/api/v1/yard/relay`
const web = process.env.HONO_WEB_URL!
const signedIn = async (userId: string) => {
  const { name, value } = await sessionCookie(userId)
  return { cookie: `${name}=${value}` }
}
const owner = await signedIn(process.env.OWNER_ID!)
const member = await signedIn(process.env.MEMBER_ID!)
const status = async (path: string, headers: Record<string, string>) =>
  (await fetch(`${relay}${path}`, { headers })).status
// a refused socket opens and closes at once with 4000 + the refusal's status (refusedUpgradeCloses in lib/server.ts)
const closeCode = (path: string, headers: Record<string, string>) =>
  new Promise<number>((done) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/yard/relay${path}`, {
      headers,
    } as never)
    socket.addEventListener("close", (event) => done(event.code))
  })
const body = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64")

const out: Record<string, unknown> = {}
out.memberSocket = await closeCode("/socket", {
  authorization: `Bearer ${process.env.MEMBER_TOKEN}`,
})
out.cookieSocket = await closeCode("/socket", { ...owner, origin: web })
out.offline = await status("/api/v1/workers", { ...owner, origin: web })

const requests: Record<string, unknown>[] = []
const mac = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/yard/relay/socket`, {
  headers: { authorization: `Bearer ${process.env.OWNER_TOKEN}` },
} as never)
mac.onmessage = (event) => {
  const request = JSON.parse(String(event.data))
  requests.push(request)
  // an answer for an id the hub is not waiting on is dropped, and the right one still lands
  const stale = "00000000-0000-4000-8000-000000000000"
  for (const [id, data] of [
    [stale, "stale"],
    [request.id, ["w1"]],
  ])
    mac.send(
      JSON.stringify({
        body: body({ data }),
        headers: { "content-disposition": "inline", "content-type": "application/json" },
        id,
        status: 200,
        type: "response",
      }),
    )
}
out.macSocket = await new Promise((done) => {
  mac.onopen = () => done("open")
  mac.onerror = () => done("error")
})
out.status = (
  await (await fetch(`${relay}/status`, { headers: { ...owner, origin: web } })).json()
).data
const read = await fetch(`${relay}/api/v1/workers?x=1`, { headers: { ...owner, origin: web } })
out.read = [
  read.status,
  await read.json(),
  ...[
    "cache-control",
    "content-disposition",
    "content-security-policy",
    "x-content-type-options",
  ].map((name) => read.headers.get(name)),
]
out.requests = requests.map(({ login, method, path }) => ({ login, method, path }))
out.member = await status("/api/v1/workers", { ...member, origin: web })
out.wrongOrigin = await status("/api/v1/workers", { ...owner, origin: "https://elsewhere.example" })
out.onboard = await status("/api/v1/onboard/sign-in", { ...owner, origin: web })
out.write = (
  await fetch(`${relay}/api/v1/workers`, { headers: { ...owner, origin: web }, method: "POST" })
).status
await new Promise((done) => {
  mac.onclose = done
  mac.close()
})
await Bun.sleep(100)
out.afterClose = await status("/api/v1/workers", { ...owner, origin: web })
const after = (
  await (await fetch(`${relay}/status`, { headers: { ...owner, origin: web } })).json()
).data
out.statusAfter = { online: after.online, since: typeof after.since }
console.log(JSON.stringify(out))
process.exit(0)

export {}
