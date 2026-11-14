import { Hono } from "../../../../../api/hono/node_modules/hono"
import { createRateLimiter } from "../../../../../api/hono/src/middlewares/rate-limiter"

// One API instance with a limiter of 1 a minute, as a hosted instance builds it; prints the status it answers one anonymous request with. rate-limiter.test.ts runs it twice, as two instances, with KV_URL set or unset.
const app = new Hono()
  .use("*", createRateLimiter({ limit: 1, windowMs: 60_000 }))
  .get("/", (c) => c.text("ok"))

console.log((await app.request("/")).status)
process.exit(0)
