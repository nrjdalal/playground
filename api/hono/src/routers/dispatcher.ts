import type { Session } from "@packages/auth"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { startDispatcher } from "@/lib/dashboard/dispatcher-start"
import {
  ApiError,
  authErrorResponses,
  conflictErrorResponses,
  errorResponse,
  forbiddenErrorResponses,
} from "@/lib/error"
import { authMiddleware, guardWrites, requireConsoleRole } from "@/middlewares"

// The home's Start <dispatcher>, for a dashboard with an account and no dispatcher: a dashboard write, behind the write guards and the owner rung.
export const dispatcherRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .post(
    "/start",
    describeRoute({
      tags: ["Dashboard"],
      description:
        "Start the dispatcher: runs the CLI's dispatcher step, which writes its brief when missing and starts it with spawn.sh. Refused while a session holds the dispatcher's name. A fixture stack starts nothing: it brings its made-up dispatcher back, or makes one when it has none.",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: resolver(
                z.object({ data: z.object({ name: z.string(), started: z.literal(true) }) }),
              ),
            },
          },
          description: "Started",
        },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...conflictErrorResponses,
        500: errorResponse("INTERNAL_SERVER_ERROR", "The dispatcher could not be started"),
        502: errorResponse("ERROR", "spawn.sh refused or failed, its reason passed through"),
      },
    }),
    async (c) => {
      const started = await startDispatcher()
      if (started.status === "started") {
        return c.json({ data: { name: started.name, started: true as const } })
      }
      if (started.status === "running") {
        throw new ApiError(409, "CONFLICT", `${started.name} is already running`)
      }
      if (started.status === "refused") throw new ApiError(502, "ERROR", started.detail)
      throw new ApiError(500, "INTERNAL_SERVER_ERROR", started.detail)
    },
  )
