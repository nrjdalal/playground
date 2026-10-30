import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { db } from "@packages/db"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import { contentType } from "@/lib/dashboard/attachments"
import {
  ApiError,
  authErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { readImage, withSizes } from "@/plugins/changelog/images"
import { listEntries, markSeen, seenAt, unreadCount } from "@/plugins/changelog/store"

const seenSchema = z.object({ at: z.iso.datetime({ offset: true }) })

// The Changelog plugin's routes, mounted by the plugin registry under /api/v1/apps/changelog behind the apps router's guards (a write passes guardWrites) and the plugin's switch.
export const changelogRouter = new Hono<{ Variables: Session }>()
  .get(
    "/",
    describeRoute({
      tags: ["Apps"],
      description:
        "What changed in the factory, newest first by when it happened (entries, at most 500): merged PRs, versions, rules, settings and ops, each one plain line with its kind, link, source key (what it came from, null for a line by hand), who wrote it, when it reached the changelog, a merge's detail in a few sentences and its screenshots by id with their size in pixels (null when the file is gone); then when this viewer last marked it read (seenAt, null before their first look). 404 while the changelog plugin is off.",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    async (c) => {
      const [entries, seen] = await Promise.all([
        listEntries(db).then((rows) => withSizes(rows)),
        seenAt(db, c.get("user").id),
      ])
      return c.json({ data: { entries, seenAt: seen?.toISOString() ?? null } })
    },
  )
  .get(
    "/unread",
    describeRoute({
      tags: ["Apps"],
      description:
        "How many entries reached the changelog since this viewer last marked it read (unread), every entry before their first look; the aside's Changelog square shows it.",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    async (c) => c.json({ data: { unread: await unreadCount(db, c.get("user").id) } }),
  )
  .post(
    "/seen",
    describeRoute({
      tags: ["Apps"],
      description:
        "Mark the changelog read up to at, the newest arrival (createdAt) the page showed, for this viewer alone. The mark never moves back and never past now; returns the mark kept (seenAt).",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    sValidator("json", seenSchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const mark = await markSeen(db, c.get("user").id, new Date(c.req.valid("json").at))
      return c.json({ data: { seenAt: mark.toISOString() } })
    },
  )
  .get(
    "/images/:id",
    describeRoute({
      tags: ["Apps"],
      description:
        "One screenshot a merge's entry names, by its id: a copy the sync kept in the owner-only changelog folder, served as the image its bytes are and never run.",
      responses: {
        200: { description: "The image" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    async (c) => {
      const found = await readImage(c.req.param("id"))
      if (!found) throw new ApiError(404, "NOT_FOUND", "No screenshot by that id")
      return new Response(found.bytes, {
        headers: {
          "cache-control": "private, max-age=86400, immutable",
          "content-disposition": "inline",
          "content-security-policy": "default-src 'none'; sandbox",
          "content-type": contentType(found.id),
          "x-content-type-options": "nosniff",
        },
      })
    },
  )
