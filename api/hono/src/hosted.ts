import { db } from "@packages/db"
import { env } from "@packages/env/api-hono"

import { baseApp } from "@/lib/base-app"
import { healthBody } from "@/lib/db-health"
import { createServer } from "@/lib/server"
import { sweepOnceADay } from "@/lib/yard/limits"
import { authRouter } from "@/routers/auth"
import { yardRouter } from "@/routers/yard"

// The hosted build's whole API (Yard): sign-in, health and Yard's routes, and nothing that reads a machine. index.ts imports it under PLAYGROUND_HOSTED alone; built on its own for Vercel, it refuses to start without the flag.
if (!env.PLAYGROUND_HOSTED) {
  console.error("refused: hosted.ts serves only with PLAYGROUND_HOSTED=1")
  process.exit(1)
}

export const app = baseApp()

// Yard forgets on time with no cron: each UTC day's first request of any kind, a read, a sign-in or a post, runs the retention sweep, and a sweep that fails never fails the request.
app.use("*", async (_, next) => {
  await sweepOnceADay(db).catch((error) => console.error("[yard] retention sweep failed", error))
  return next()
})

app
  .basePath("/api")
  .get("/health", async (c) =>
    // the local health body's shape, so the web reads one; the hosted web draws no dispatcher rows, so the count is the default 1, and a deploy is never a Vibeground
    c.json({ data: await healthBody({ dashboard: "hosted", dispatcherSlots: 1, vibe: null }) }),
  )
  .route("/auth", authRouter)
  .route("/v1/yard", yardRouter)

// On Vercel an http.Server that never listens (lib/server.ts), with the WebSocket upgrade on it.
export default createServer(app)
