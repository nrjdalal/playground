import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { env } from "@packages/env/api-hono"
import { channelSchema, messageSchema } from "@packages/message"
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
import { pageSchema, postSchema, yardClient } from "@/lib/yard/client"
import { keychain } from "@/lib/yard/keychain"
import { localYard } from "@/lib/yard/local"
import { authMiddleware, guardWrites, requireConsoleRole, requireLoopback } from "@/middlewares"

const valid = <T extends z.ZodType>(target: "json" | "query", schema: T) =>
  sValidator(target, schema, (result) => {
    if (!result.success)
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
  })

const doc = (description: string, data: z.ZodType, refusals: object[] = []) =>
  describeRoute({
    tags: ["Yard"],
    description,
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: resolver(z.object({ data })) } },
      },
      ...authErrorResponses,
      ...forbiddenErrorResponses,
      ...notFoundErrorResponses,
      ...Object.assign({}, ...refusals),
    },
  })

const yard = localYard({
  api: env.YARD_API_URL,
  client: yardClient,
  keychain: keychain(),
})

// The local Playground's Yard (lib/yard/local.ts): the hosted Yard's channels, DMs and messages read and posted with the Mac's token, on the dashboard's owner rung over loopback, so the local sidebar shows them; with YARD_API_URL unset or no token, each answers 404.
export const localYardRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/*", requireLoopback)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/channels",
    doc(
      "Every Yard channel and your DMs, with unread and mention counts",
      z.object({ channels: z.array(channelSchema) }),
    ),
    async (c) => c.json({ data: await yard.channels() }),
  )
  .get(
    "/channels/:id/messages",
    doc(
      "A page of a channel's messages, oldest first",
      z.object({ messages: z.array(messageSchema), hasMore: z.boolean() }),
      [validationErrorResponses],
    ),
    valid("query", pageSchema),
    async (c) => c.json({ data: await yard.messages(c.req.param("id"), c.req.valid("query")) }),
  )
  .post(
    "/channels/:id/messages",
    doc(
      "Posts a message as this Mac; one Yard holds pending puts an Inbox card up whose Approve opens Yard's approve page",
      z.object({ message: messageSchema }),
      [validationErrorResponses],
    ),
    valid("json", postSchema),
    async (c) => c.json({ data: await yard.post(c.req.param("id"), c.req.valid("json")) }, 201),
  )
  .post(
    "/channels/:id/read",
    doc("Marks a channel read up to now", z.object({ lastReadAt: z.iso.datetime() })),
    async (c) => c.json({ data: await yard.read(c.req.param("id")) }),
  )
