import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

// The API's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves here. Set before the server module loads.
process.env.BETTER_AUTH_SECRET ||= "server-test-secret-not-for-use-anywhere"
const { refusedUpgradeCloses } = await import("../../../../../api/hono/src/lib/server")
const { ApiError, errorHandler } = await import("../../../../../api/hono/src/lib/error")
const { createAdaptorServer, upgradeWebSocket } =
  await import("../../../../../api/hono/node_modules/@hono/node-server")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")
// ws ships no types of its own and api/hono's @types/ws describes it, so the import names its path through a value and takes that package's type
const wsPath = "../../../../../api/hono/node_modules/ws"
const { WebSocketServer } = (await import(
  wsPath
)) as typeof import("../../../../../api/hono/node_modules/@types/ws")

// The hosted build's shape: the Node adapter with a route that refuses before upgradeWebSocket, and a second upgrade listener on the server, under which the adapter writes no refusal, as on Vercel.
const app = new Hono()
app.onError(errorHandler)
app.use("*", refusedUpgradeCloses(upgradeWebSocket as never))
app.get(
  "/socket",
  async (c, next) => {
    const auth = c.req.header("authorization")
    if (auth === "Bearer member")
      throw new ApiError(403, "FORBIDDEN", "Only the owner's Mac holds the relay")
    if (auth === "Bearer long") throw new ApiError(401, "UNAUTHORIZED", "é".repeat(100))
    if (auth !== "Bearer owner") throw new ApiError(401, "UNAUTHORIZED", "Unauthorized")
    return next()
  },
  upgradeWebSocket(() => ({ onOpen: (_, socket) => socket.send("joined") })),
)
const server = createAdaptorServer({
  fetch: app.fetch,
  websocket: { server: new WebSocketServer({ noServer: true }) },
}) as Server
server.on("upgrade", () => {})
let url = ""

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/socket`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

// What a Bun WebSocket opened with the token hears: its first frame, or its close code and reason, or a socket left connecting.
const dial = (token: string) =>
  new Promise<string>((done) => {
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as never)
    const stalled = setTimeout(() => done(`still connecting: ${socket.readyState}`), 2000)
    socket.addEventListener("message", (event) => {
      clearTimeout(stalled)
      done(`frame ${String(event.data)}`)
      socket.close()
    })
    socket.addEventListener("close", (event) => {
      clearTimeout(stalled)
      done(`close ${event.code} ${event.reason}`)
    })
  })

describe("refusedUpgradeCloses, the hosted API's refused WebSocket upgrade", () => {
  // on Vercel a refusal before the upgrade reached no client, which sat in CONNECTING
  test("a refused token's upgrade is closed with 4401 and the refusal's message", async () => {
    expect(await dial("yard_fake")).toBe("close 4401 Unauthorized")
  })

  test("a forbidden caller's upgrade is closed with 4403 and the refusal's message", async () => {
    expect(await dial("member")).toBe("close 4403 Only the owner's Mac holds the relay")
  })

  test("a refusal whose message passes a close reason's 123 bytes is cut at a whole character", async () => {
    expect(await dial("long")).toBe(`close 4401 ${"é".repeat(61)}`)
  })

  test("an allowed upgrade opens and reaches the route's own handler", async () => {
    expect(await dial("owner")).toBe("frame joined")
  })
})
