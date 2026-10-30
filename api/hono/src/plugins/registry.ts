import type { Session } from "@packages/auth"
import { Hono } from "hono"

import { changelogRouter } from "@/plugins/changelog/router"
import { requirePlugin } from "@/plugins/switch"

// Every plugin, by static import so the RPC client stays typed. A plugin is one folder, its switch in switch.ts and its line here; it never imports another plugin, and core reaches it only through this file. The apps router mounts this one under /api/v1/apps, so its guards and owner rung cover every plugin route.
export const pluginsRouter = new Hono<{ Variables: Session }>()
  .use("/changelog/*", requirePlugin("changelog"))
  .route("/changelog", changelogRouter)

export type * from "@/plugins/changelog/types"
