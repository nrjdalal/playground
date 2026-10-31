import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { db } from "@packages/db"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import { deliver } from "@/lib/dashboard/deliver"
import {
  answerInputSchema,
  answerItem,
  dismissItems,
  listItems,
  markRead,
  provideSecret,
  retryDelivery,
  scheduleItem,
  secretInputSchema,
} from "@/lib/dashboard/inbox"
import { runSink } from "@/lib/dashboard/secret-sink"
import { DISPATCHER } from "@/lib/dashboard/workers"
import {
  ApiError,
  authErrorResponses,
  conflictErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import {
  authMiddleware,
  guardWrites,
  requireConsoleRole,
  requireLoopback,
  requireTrustedOrigin,
} from "@/middlewares"
import { serveAttachment } from "@/routers/dashboard"

const STATUS = { CONFLICT: 409, NOT_FOUND: 404, VALIDATION_ERROR: 400 } as const

const invalid = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
  }
}

const idsInputSchema = z.strictObject({ ids: z.array(z.string().min(1)).min(1).max(200) })

// A secret's refusal names no field and carries no issue, so nothing of what was typed comes back.
const invalidSecret = (result: { success: boolean }) => {
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "A secret takes one value that is not empty")
  }
}

const scheduleInputSchema = z.strictObject({ at: z.iso.datetime() })

// Playground's Inbox (see lib/dashboard/inbox.ts), on the dashboard's owner rung since an answer is typed into a session. Its writes must come from the dashboard's own page on this machine before anything else is read.
export const inboxRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/attachments/*", requireTrustedOrigin, requireLoopback)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Playground's Inbox in priority order: open decisions and drafts, then unread updates, then the rest of the last week, each newest first, with the count of what needs the owner",
      responses: { 200: { description: "OK" }, ...authErrorResponses, ...forbiddenErrorResponses },
    }),
    async (c) => c.json({ data: await listItems(db) }),
  )
  .get(
    "/attachments/:id",
    describeRoute({
      tags: ["Inbox"],
      description:
        "One file an ask or a read-only update carries, by the id it was kept under: only for the Dashboard's own page on this machine, which fetches it with its cookie, so a page elsewhere cannot embed it",
      responses: {
        200: { description: "The file" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    (c) => serveAttachment(c.req.param("id")),
  )
  .post(
    "/dismiss",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Move the updates and answered decisions and drafts named to Done at once, rather than ten minutes after they settled, recording when in their answer and marking an update read; an open decision or draft is left as it is",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    sValidator("json", idsInputSchema, invalid),
    async (c) => c.json({ data: { dismissed: await dismissItems(db, c.req.valid("json").ids) } }),
  )
  .post(
    "/read",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Mark the items named read: updates, and open decisions and drafts, which stay open",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    sValidator("json", idsInputSchema, invalid),
    async (c) => c.json({ data: { read: await markRead(db, c.req.valid("json").ids) } }),
  )
  .post(
    "/:id/answer",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Answer an open decision (approve, deny, clear to set it aside as Archive, or edit with words) or draft (send, or for a Slack draft save it as a draft in Slack, each as written or changed, or discard), with his optional note. With seen, the updatedAt of the card he answered, it is refused when the item has changed since. The answer is kept, then typed into the posting session through the delivery adapter, and that session carries it out; the Dashboard itself sends nothing",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator("json", answerInputSchema, invalid),
    async (c) => {
      const user = c.get("user")
      const result = await answerItem(db, c.req.param("id"), c.req.valid("json"), {
        actor: { email: user.email, id: user.id },
        deliver,
        dispatcher: DISPATCHER,
      })
      if (!result.ok) throw new ApiError(STATUS[result.code], result.code, result.message)
      return c.json({ data: result.item })
    },
  )
  .post(
    "/:id/retry",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Type an answer whose delivery failed into the posting session again, through the delivery adapter, and record how that went",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    async (c) => {
      const user = c.get("user")
      const result = await retryDelivery(db, c.req.param("id"), {
        actor: { email: user.email, id: user.id },
        deliver,
        dispatcher: DISPATCHER,
      })
      if (!result.ok) throw new ApiError(STATUS[result.code], result.code, result.message)
      return c.json({ data: result.item })
    },
  )
  .post(
    "/:id/secret",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Answer an open secret ask with its value, which goes straight to the ask's sink on stdin, once an environment, and is kept nowhere: the item records only when it was provided and each exit status, and its poster is told that alone",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator("json", secretInputSchema, invalidSecret),
    async (c) => {
      const user = c.get("user")
      const result = await provideSecret(db, c.req.param("id"), c.req.valid("json"), {
        actor: { email: user.email, id: user.id },
        deliver,
        dispatcher: DISPATCHER,
        run: runSink,
      })
      if (!result.ok) throw new ApiError(STATUS[result.code], result.code, result.message)
      return c.json({ data: result.item })
    },
  )
  .post(
    "/:id/schedule",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Push an open decision or draft out of the inbox and its count until a time, when it asks again; answering it or replying to it in chat wakes it at once",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
        ...conflictErrorResponses,
      },
    }),
    sValidator("json", scheduleInputSchema, invalid),
    async (c) => {
      const result = await scheduleItem(db, c.req.param("id"), c.req.valid("json").at)
      if (!result.ok) throw new ApiError(STATUS[result.code], result.code, result.message)
      return c.json({ data: result.item })
    },
  )
