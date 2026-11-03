import { env } from "@packages/env/api-hono"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { errorHandler, jsonError } from "@/lib/error"
import { rateLimiterMiddleware } from "@/middlewares/rate-limiter"

// The Hono app both builds start from (local.ts and hosted.ts): CORS for the trusted origins, the request log, the rate limit, and the JSON error and 404 bodies.
export const baseApp = () => {
  const app = new Hono()
  app.use(
    "*",
    cors({
      origin: env.HONO_TRUSTED_ORIGINS,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
      exposeHeaders: ["content-length"],
      maxAge: 600,
      credentials: true,
    }),
    logger(),
    rateLimiterMiddleware,
  )
  app.onError(errorHandler)
  app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Not Found"))
  return app
}
