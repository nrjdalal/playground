import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import {
  ApiError,
  authErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { remoteKeys as keys } from "@/lib/relay/key"
import { authMiddleware, guardWrites, requireConsoleRole, requireLoopback } from "@/middlewares"

const pairedSchema = z.object({ fingerprint: z.string(), login: z.string(), pairedAt: z.string() })
const pendingSchema = z.object({
  at: z.string(),
  fingerprint: z.string(),
  id: z.string(),
  login: z.string(),
})

const doc = (description: string, data: z.ZodType, errors = {}) =>
  describeRoute({
    tags: ["Dashboard"],
    description,
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: resolver(z.object({ data })) } },
      },
      ...authErrorResponses,
      ...forbiddenErrorResponses,
      ...errors,
    },
  })

// Settings' Remote section: the browser key this Mac takes Yard's writes from, the pair request waiting on the owner's Approve, and Approve and Revoke, all on the owner rung over loopback, so a key is paired only by a click on this Mac and the relay, which runs no route off RELAY_GETS, reaches none of it.
export const remoteRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/*", requireLoopback)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/",
    doc(
      "The paired browser key, by its fingerprint, login and paired time, and the pair request waiting on Approve, each null with none",
      z.object({ key: pairedSchema.nullable(), pending: pendingSchema.nullable() }),
    ),
    async (c) => {
      const key = await keys.paired()
      const pending = keys.pending()
      return c.json({
        data: {
          key: key && { fingerprint: key.fingerprint, login: key.login, pairedAt: key.pairedAt },
          pending: pending && {
            at: pending.at,
            fingerprint: pending.fingerprint,
            id: pending.id,
            login: pending.login,
          },
        },
      })
    },
  )
  .post(
    "/approve",
    doc(
      "Pairs the waiting request's key with this Mac, which revokes the key paired before it",
      pairedSchema,
      { ...notFoundErrorResponses, ...validationErrorResponses },
    ),
    sValidator("json", z.strictObject({ id: z.uuid() }), (result) => {
      if (!result.success)
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
    }),
    async (c) => {
      const key = await keys.approve(c.req.valid("json").id)
      if (!key) throw new ApiError(404, "NOT_FOUND", "No pair request waits with that id")
      return c.json({
        data: { fingerprint: key.fingerprint, login: key.login, pairedAt: key.pairedAt },
      })
    },
  )
  .post(
    "/revoke",
    doc(
      "Revokes the paired key and drops any waiting request, so the key's next write is refused",
      z.object({ revoked: z.literal(true) }),
    ),
    async (c) => {
      await keys.revoke()
      return c.json({ data: { revoked: true as const } })
    },
  )
