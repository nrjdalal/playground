import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { db } from "@packages/db"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import { readAttachment } from "@/lib/dashboard/attachments"
import { deliver } from "@/lib/dashboard/deliver"
import { readsLive } from "@/lib/dashboard/fixture"
import {
  answerInputSchema,
  answerItem,
  attachmentDownloadName,
  dismissItems,
  listItems,
  markRead,
  provideSecret,
  retryDelivery,
  scheduleItem,
  secretInputSchema,
} from "@/lib/dashboard/inbox"
import { runArgv } from "@/lib/dashboard/run-argv"
import { runSink, saveToKeychain } from "@/lib/dashboard/secret-sink"
import { slackUpload } from "@/lib/dashboard/slack-upload"
import { DISPATCHER } from "@/lib/dashboard/workers"
import {
  ApiError,
  authErrorResponses,
  conflictErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { ownerApps, runCli } from "@/lib/store/extensions"
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

// a card's own Done sets tell, so its update's poster is told done; a shelf's bulk leaves it out and types nothing
const dismissInputSchema = idsInputSchema.extend({ tell: z.literal(true).optional() })

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
        "One file an ask, a draft, a Slack decision or a read-only update carries, by the id it was kept under: only for the Dashboard's own page on this machine, which fetches it with its cookie, so a page elsewhere cannot embed it. With ?download it saves under its item's title, the file's own name after it when the item carries several, with the stored file's extension",
      responses: {
        200: { description: "The file" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    (c) =>
      serveAttachment(
        c.req.param("id"),
        readAttachment,
        c.req.query("download") === undefined ? undefined : (id) => attachmentDownloadName(db, id),
      ),
  )
  .post(
    "/dismiss",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Done: move the updates and answered decisions and drafts named to Done at once, where no clock would move them, recording when in their answer, waking any put off or archived, and marking an update read; with tell, a card's own Done, each update's poster is told done through the delivery adapter, so it posts a new card rather than editing this one, while a shelf's bulk types nothing; an open decision or draft is left as it is",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    sValidator("json", dismissInputSchema, invalid),
    async (c) => {
      const user = c.get("user")
      const { ids, tell } = c.req.valid("json")
      const dismissed = await dismissItems(
        db,
        ids,
        new Date(),
        tell && { actor: { email: user.email, id: user.id }, deliver, dispatcher: DISPATCHER },
      )
      return c.json({ data: { dismissed } })
    },
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
        "Answer an open decision (approve, deny, clear to set it aside, or edit with words) or draft (send, or for a Slack draft save it as a draft in Slack, each as written or changed, discard, or clear to set it aside), with his optional note; archive what waits, or an update, out of the list unanswered, or move it back (unarchive), a set-aside one included, each telling its poster nothing; or dismiss it to Done, which sets aside what still waits as clear does, telling its poster set-aside, and marks anything else dismissed, telling its poster dismiss: drop it, with how to close it. With seen, the updatedAt of the card he answered, it is refused when the item has changed since. The answer is kept, then typed into the posting session through the delivery adapter, and that session carries it out; the Dashboard itself sends no message, and only shares a Slack send's files into its channel and thread first (dm upload), a failed share failing the send before anything is typed. An accept, an apps change and a grant are the decisions whose Approve the Dashboard carries out itself. An accept's Approve: once the answer is kept, it runs the extensions store's accept of <scope> <kind> <key> <rev> from the preview's words, with no role, records its exit code and line under accepted, and tells the poster. An apps change's Approve writes the owner's own desktop-owner-apps list, the login scope's, with the app added or removed, through the store's put with no role, and records its line under listed. A grant's Approve opens System Settings at the pane for its permission (Accessibility or Screen Recording) on this Mac, a stack reading the live machine alone, records its line under opened, and tells the poster to recheck the grant",
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
        accept: runCli(),
        actor: { email: user.email, id: user.id },
        apps: ownerApps(),
        deliver,
        dispatcher: DISPATCHER,
        // a stack showing test data opens nothing on this Mac's screen
        grant: readsLive() ? runArgv : undefined,
        upload: slackUpload(),
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
        "Type an answer whose delivery failed into the posting session again, through the delivery adapter, sharing a Slack send's files first when none were shared, and record how that went",
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
        upload: slackUpload(),
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
        "Later: push an open decision or draft, or an update, out of the inbox and its count until a time, when it asks again, taking an archived one off the Archived shelf; answering it or replying to it in chat wakes it at once",
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
  .post(
    "/:id/secret",
    describeRoute({
      tags: ["Inbox"],
      description:
        "Answer an open secret ask with its value, which goes straight to the ask's sink on stdin, once a Vercel environment or once to a Keychain item, and is kept nowhere: the item records only when it was provided and each exit status or saved, and its poster is told that alone",
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
        keychain: saveToKeychain,
        run: runSink,
      })
      if (!result.ok) throw new ApiError(STATUS[result.code], result.code, result.message)
      return c.json({ data: result.item })
    },
  )
