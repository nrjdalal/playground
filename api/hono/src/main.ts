import { resolve } from "node:path"

import "@packages/env/api-hono"
import { Hono } from "hono"

import { branchOf } from "@/lib/dashboard/fixture"
import { createServer } from "@/lib/server"
import { type Fetch, firstRun } from "@/lib/setup/app"
import { setupName, startLocal } from "@/lib/setup/container"

// The dev entry (`bun run dev`): with a database it serves index.ts's app; with POSTGRES_URL unset or empty it serves setup mode (lib/setup/app.ts) until Start a local container has made one, then index.ts's app in this process. The built bundle serves index.ts alone.

const normal = async (): Promise<Fetch> =>
  ((await import("@/index")).default as unknown as { fetch: Fetch }).fetch

const root = resolve(process.cwd(), "../..")

const serve: Fetch = process.env.POSTGRES_URL
  ? await normal()
  : firstRun(async (onStep) => {
      const branch = branchOf(root)
      process.env.POSTGRES_URL = await startLocal({
        branch,
        envFile: resolve(root, ".env"),
        name: setupName(root, branch),
        onStep,
      })
    }, normal)

const front = new Hono()
front.all("*", (c) => serve(c.req.raw, c.env))

const server = createServer(front)
export default server
