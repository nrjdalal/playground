import { Hono } from "hono"

import { upgradeWebSocket } from "@/lib/server"

// Yard's routes, which only the hosted build mounts (hosted.ts). The socket answers its upgrade first, so a preview deploy can show the 101 before the routes behind it land.
export const yardRouter = new Hono().get(
  "/socket",
  upgradeWebSocket(() => ({})),
)
