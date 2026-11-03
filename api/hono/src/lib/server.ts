import { createAdaptorServer, upgradeWebSocket as nodeUpgradeWebSocket } from "@hono/node-server"
import { env } from "@packages/env/api-hono"
import type { Hono } from "hono"
import { upgradeWebSocket as bunUpgradeWebSocket, websocket } from "hono/bun"
import { WebSocketServer } from "ws"

// On Vercel we serve WebSockets through the Node adapter (@hono/node-server + ws), the setup Vercel documents for Hono; everywhere else (local, Docker/self-host) Bun.serve() owns the socket via hono/bun.
const onVercel = process.env.VERCEL === "1"

// Both adapters accept the same handler factory; the cast collapses their otherwise non-unionable signatures to one callable type. Registered on a route in local.ts.
export const upgradeWebSocket = onVercel
  ? (nodeUpgradeWebSocket as typeof bunUpgradeWebSocket)
  : bunUpgradeWebSocket

// On Vercel, return a Node http.Server that has not called listen(), so the platform drives all traffic including the WebSocket upgrade: a server that already listens (serve() calls listen) hangs 60s there and answers 500. Elsewhere return the Bun.serve() shape so Bun owns fetch + the socket, bound to HONO_HOSTNAME (loopback by default), on process.env.PORT when set (portless assigning a dev port), else HONO_PORT.
export const createServer = (app: Hono) =>
  onVercel
    ? createAdaptorServer({
        fetch: app.fetch,
        websocket: { server: new WebSocketServer({ noServer: true }) },
      })
    : {
        fetch: app.fetch,
        hostname: env.HONO_HOSTNAME,
        port: process.env.PORT ? Number(process.env.PORT) : env.HONO_PORT,
        websocket,
      }
